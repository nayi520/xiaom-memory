import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { notes } from '@/lib/db/schema';
import { advanceTranscription } from '@/lib/asr/complete';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 单次最多推进若干条「转写中」记录，每条完成时含取文本 + 会议纪要/P8 总结，给足时长。
export const maxDuration = 300;

/** 单次 cron 最多处理的「转写中」记录数（防一次跑太久）。可经 env 覆盖。 */
const BATCH = (() => {
  const n = Number(process.env.MEMORY_TRANSCRIBE_CRON_BATCH);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 20;
})();

/**
 * GET/POST /api/cron/transcribe —— 异步转写兜底（V27）
 * 鉴权：Authorization: Bearer ${CRON_SECRET}
 *
 * 扫描所有 transcribe_status='transcribing' 的 note，逐条 advanceTranscription（查任务 → 完成则取文本+总结+落库）。
 * 让会议录音即使在前端关闭、不再轮询的情况下，也能在 cron 间隔内自动完成转写与纪要整理。
 * 建议 crontab：每 2–5 分钟打一次（见 .env.example）。
 */
async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: '服务端未配置 CRON_SECRET' }, { status: 500 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: '鉴权失败' }, { status: 401 });
  }
  if (!process.env.DASHSCOPE_API_KEY) {
    return NextResponse.json(
      { error: '未配置 DASHSCOPE_API_KEY，转写不可用' },
      { status: 503 }
    );
  }

  const db = getDb();
  const pending = await db
    .select({
      id: notes.id,
      userId: notes.userId,
      transcribeTaskId: notes.transcribeTaskId,
    })
    .from(notes)
    .where(eq(notes.transcribeStatus, 'transcribing'))
    .limit(BATCH);

  let completed = 0;
  let failed = 0;
  let stillRunning = 0;
  for (const note of pending) {
    try {
      const r = await advanceTranscription(db, note);
      if (r.status === 'done') completed += 1;
      else if (r.status === 'failed') failed += 1;
      else stillRunning += 1;
    } catch (err) {
      // advanceTranscription 本身 fail-soft，这里再兜一层，单条异常不影响其余。
      console.error('[cron/transcribe] 单条推进异常：', err);
      stillRunning += 1;
    }
  }

  return NextResponse.json({
    checked: pending.length,
    completed,
    failed,
    stillRunning,
    batch: BATCH,
  });
}

export const GET = handle;
export const POST = handle;
