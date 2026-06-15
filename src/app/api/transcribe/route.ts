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

    return NextResponse.json({ transcribed: true, transcript: text });
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
