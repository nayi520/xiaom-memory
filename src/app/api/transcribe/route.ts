import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { notes } from '@/lib/db/schema';
import { getPublicTaskUrl, OssConfigMissingError } from '@/lib/storage/oss';
import {
  transcribeAudioUrl,
  AsrKeyMissingError,
  AsrTimeoutError,
} from '@/lib/asr/funasr';
import { enforceAiRateLimit } from '@/lib/ratelimit';
import { consumeQuota } from '@/lib/quota';
import { createAnthropicClient } from '@/lib/llm';
import { summarizeTranscript, type SummarizeStore } from '@/features/digest/summarize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Fun-ASR 是「提交公网音频 URL → 异步任务 → 轮询取结果」，长音频可能较久。
// 故放宽到 300s（funasr 模块默认轮询总超时 5min，对齐）。
// 注：若后续要支持超长音频，可改为「提交即返回 task_id + 前端/后续查询」的异步模式；
// 本期同步轮询，3 分钟内录音足够用。
export const maxDuration = 300;

/**
 * POST /api/transcribe  { noteId }
 * 取 note 对应音频的 OSS 公网签名 URL → Fun-ASR 转写 → 写回 transcript / raw_content。
 *
 * 去 Supabase 改造（Phase C）：
 *   - 音频不再从 supabase.storage 下载，改用 getPublicTaskUrl(media_path) 给 Fun-ASR 自行拉取；
 *   - 转写从 Whisper（OpenAI）切到 Fun-ASR（百炼录音文件异步识别）；
 *   - notes 读/写走 Drizzle、鉴权 getCurrentUser（Phase B 已就绪）。
 * 未配置 DASHSCOPE_API_KEY / OSS 时优雅降级（音频已保存，转写待配置），不报 500。
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  let noteId: string | undefined;
  try {
    ({ noteId } = await request.json());
  } catch {
    /* noop */
  }
  if (!noteId) {
    return NextResponse.json({ error: '缺少 noteId' }, { status: 400 });
  }

  const db = getDb();
  // 显式按 user_id 过滤（原靠 RLS）。
  const noteRows = await db
    .select({ id: notes.id, type: notes.type, media_path: notes.mediaPath })
    .from(notes)
    .where(and(eq(notes.id, noteId), eq(notes.userId, user.id)))
    .limit(1);
  const note = noteRows[0];
  if (!note || note.type !== 'voice' || !note.media_path) {
    return NextResponse.json({ error: '记录不存在或非语音' }, { status: 404 });
  }
  // L-1 加固：纵深防御——只对本人 OSS 前缀的音频签名，杜绝越权转写他人音频对象。
  if (!note.media_path.startsWith(`audio/${user.id}/`)) {
    return NextResponse.json({ error: '记录不存在或非语音' }, { status: 404 });
  }

  // 成本/滥用闸：转写（Fun-ASR）按 userId 限流 + 每日配额。确认是本人语音记录后、产生 ASR 成本前拦。
  const rl = enforceAiRateLimit(user.id, 'transcribe');
  if (!rl.ok) {
    return NextResponse.json(
      { error: '操作过于频繁，请稍后再试', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    );
  }
  const quota = await consumeQuota(user.id, 'transcribe');
  if (!quota.ok) {
    return NextResponse.json(
      { error: '今日额度已用尽', kind: 'transcribe', limit: quota.limit },
      { status: 429 }
    );
  }

  // 取给 Fun-ASR 拉取音频用的公网签名 URL。OSS 未配置时优雅降级。
  let audioUrl: string;
  try {
    audioUrl = await getPublicTaskUrl(note.media_path);
  } catch (err) {
    if (err instanceof OssConfigMissingError) {
      return NextResponse.json({
        transcribed: false,
        message: '转写待配置（存储未配置），音频已保存',
      });
    }
    console.error('[transcribe] 取音频 URL 失败：', err);
    return NextResponse.json({ error: '音频地址生成失败' }, { status: 500 });
  }

  try {
    const { text } = await transcribeAudioUrl(audioUrl);

    try {
      await db
        .update(notes)
        .set({ transcript: text, rawContent: text })
        .where(and(eq(notes.id, noteId), eq(notes.userId, user.id)));
    } catch {
      return NextResponse.json({ error: '转写结果保存失败' }, { status: 500 });
    }

    // P8：转写成功后即时 AI 加工（摘要 + 关键要点 + 待办 + 涉及）→ 写回 summary / raw_content。
    // transcript 保持原始不动（供每晚 P7 清洗 / P1 概念抽取）；LLM 不可用/缺 key 时优雅降级，仅保留转写。
    const summaryStore: SummarizeStore = {
      async updateSummary(id, uid, patch) {
        const rows = await db
          .update(notes)
          .set({ summary: patch.summary, rawContent: patch.rawContent })
          .where(and(eq(notes.id, id), eq(notes.userId, uid)))
          .returning({ id: notes.id });
        return rows.length > 0;
      },
    };
    const sum = await summarizeTranscript(noteId, user.id, text, {
      llm: createAnthropicClient(),
      store: summaryStore,
    });

    return NextResponse.json({
      transcribed: true,
      transcript: text,
      summarized: sum.ok,
      summary: sum.ok ? sum.summary : undefined,
      raw_content: sum.ok ? sum.rawContent : undefined,
    });
  } catch (err) {
    if (err instanceof AsrKeyMissingError) {
      // 优雅降级：未配置 DASHSCOPE_API_KEY 时不报错，提示待配置。
      return NextResponse.json({
        transcribed: false,
        message: '转写待配置（未设置 DASHSCOPE_API_KEY），音频已保存',
      });
    }
    if (err instanceof AsrTimeoutError) {
      console.error('[transcribe] Fun-ASR 超时：', err.message);
      return NextResponse.json({
        transcribed: false,
        message: '转写超时，音频已保存（稍后可重试）',
      });
    }
    console.error('[transcribe] Fun-ASR error:', err);
    return NextResponse.json({
      transcribed: false,
      message: '转写失败，音频已保存（稍后可重试）',
    });
  }
}
