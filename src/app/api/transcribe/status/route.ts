import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { notes } from '@/lib/db/schema';
import { advanceTranscription } from '@/lib/asr/complete';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 命中「完成」那次轮询会顺带取文本 + 跑会议纪要/P8 总结（长会议较慢），给足时长。
export const maxDuration = 180;

/**
 * GET /api/transcribe/status?noteId=...  —— 查询/推进异步转写（V27）
 *
 * 前端在录音上传 + POST /api/transcribe 之后，每隔几秒轮询本接口：
 *   - transcribing → 还在转写（继续轮询）
 *   - done         → 返回 transcript / summary / raw_content（停止轮询、刷新展示）
 *   - failed       → 返回 message（停止轮询、提示「音频已保存，可重试」）
 *
 * 幂等：已 done/failed 直接回；transcribing 时调 advanceTranscription 推进一步（完成则落库 + 总结）。
 * cron 兜底同样调 advanceTranscription，故关页后再回来轮询也能拿到已完成结果。
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const noteId = new URL(request.url).searchParams.get('noteId');
  if (!noteId) {
    return NextResponse.json({ error: '缺少 noteId' }, { status: 400 });
  }

  const db = getDb();
  const rows = await db
    .select({
      id: notes.id,
      userId: notes.userId,
      type: notes.type,
      transcribeStatus: notes.transcribeStatus,
      transcribeTaskId: notes.transcribeTaskId,
      transcript: notes.transcript,
      summary: notes.summary,
      rawContent: notes.rawContent,
    })
    .from(notes)
    .where(and(eq(notes.id, noteId), eq(notes.userId, user.id)))
    .limit(1);
  const note = rows[0];
  if (!note || note.type !== 'voice') {
    return NextResponse.json({ error: '记录不存在或非语音' }, { status: 404 });
  }

  // 已完成：幂等直接回（不重复扣费 / 不重复总结）。
  if (note.transcribeStatus === 'done') {
    return NextResponse.json({
      status: 'done',
      transcript: note.transcript ?? '',
      summary: note.summary ?? undefined,
      raw_content: note.rawContent ?? undefined,
    });
  }
  if (note.transcribeStatus === 'failed') {
    return NextResponse.json({ status: 'failed', message: '转写失败，音频已保存（可重试）' });
  }

  // 转写中：推进一步（pending 原样回；命中完成则取文本 + 总结 + 落库后回 done）。
  if (note.transcribeStatus === 'transcribing') {
    const r = await advanceTranscription(db, note);
    return NextResponse.json(r);
  }

  // 无异步状态：可能是旧的同步路径已写好 transcript，或还没发起转写。
  if (note.transcript) {
    return NextResponse.json({
      status: 'done',
      transcript: note.transcript,
      summary: note.summary ?? undefined,
      raw_content: note.rawContent ?? undefined,
    });
  }
  return NextResponse.json({ status: 'idle' });
}
