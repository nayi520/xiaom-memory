import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { notes } from '@/lib/db/schema';
import { getPublicTaskUrl, OssConfigMissingError } from '@/lib/storage/oss';
import { submitTranscription, AsrKeyMissingError } from '@/lib/asr/funasr';
import { enforceAiRateLimit } from '@/lib/ratelimit';
import { consumeQuota } from '@/lib/quota';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 改异步后只「提交任务」即返回（不再阻塞轮询），故时长可收紧。结果由 /api/transcribe/status 轮询完成。
export const maxDuration = 60;

/**
 * POST /api/transcribe  { noteId }  —— 启动异步转写（会议记录 / 长音频，V27）
 *
 * 改造前：同步「提交 + 轮询 + 取文本 + 总结」一次返回，受 300s 时长所限只能撑 ~3 分钟录音。
 * 改造后：取音频签名 URL → 提交 Fun-ASR 异步任务 → 存 task_id + transcribe_status='transcribing'
 *         → **立即返回** {status:'transcribing'}。前端用 GET /api/transcribe/status?noteId 轮询完成；
 *         即使前端关掉，/api/cron/transcribe 也会在 cron 间隔内兜底完成（取文本 + 会议纪要/P8 总结）。
 *
 * 兼容：响应同时带 transcribed:false + message，旧客户端（按 transcribed 判断）会降级显示「转写中」而非报错。
 * 降级：未配置 DASHSCOPE_API_KEY / OSS 时不报 500，提示待配置、音频已保存。
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
        status: 'failed',
        transcribed: false,
        message: '转写待配置（存储未配置），音频已保存',
      });
    }
    console.error('[transcribe] 取音频 URL 失败：', err);
    return NextResponse.json({ error: '音频地址生成失败' }, { status: 500 });
  }

  // 提交异步转写任务，存 task_id + 状态，立即返回。
  try {
    const taskId = await submitTranscription(audioUrl);
    await db
      .update(notes)
      .set({ transcribeStatus: 'transcribing', transcribeTaskId: taskId })
      .where(and(eq(notes.id, noteId), eq(notes.userId, user.id)));

    return NextResponse.json({
      status: 'transcribing',
      noteId,
      transcribed: false,
      message: '转写已开始，长会议可能需要几分钟，完成后会自动整理',
    });
  } catch (err) {
    if (err instanceof AsrKeyMissingError) {
      return NextResponse.json({
        status: 'failed',
        transcribed: false,
        message: '转写待配置（未设置 DASHSCOPE_API_KEY），音频已保存',
      });
    }
    console.error('[transcribe] 提交转写任务失败：', err);
    return NextResponse.json({
      status: 'failed',
      transcribed: false,
      message: '转写启动失败，音频已保存（稍后可重试）',
    });
  }
}
