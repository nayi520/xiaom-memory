/**
 * 推进「转写中」的 note —— status 路由（前端轮询）与 cron 兜底共用的完成逻辑。
 *
 * 异步转写流程：/api/transcribe 提交 Fun-ASR 任务 → 存 transcribe_task_id + status='transcribing' → 立即返回。
 * 之后由本模块 advanceTranscription 查任务：
 *   pending → 原样返回 transcribing；
 *   done    → 取整段文本 → 写 transcript/raw_content + status='done' → 跑总结（会议纪要/P8）→ 返回 done；
 *   failed  → 写 status='failed' → 返回 failed。
 *
 * 设计：幂等（done/failed 都落库，重复调用安全）、fail-soft（绝不抛出；取结果/落库的暂时性失败留作 transcribing 下次再推进）。
 */

import { and, eq } from 'drizzle-orm';
import type { getDb } from '@/lib/db/client';
import { notes } from '@/lib/db/schema';
import {
  checkTranscription,
  fetchTranscriptText,
  AsrKeyMissingError,
} from './funasr';
import { createAnthropicClient } from '@/lib/llm';
import { summarizeTranscript, type SummarizeStore } from '@/features/digest/summarize';

type Db = ReturnType<typeof getDb>;

export interface TranscribeStatusResult {
  status: 'transcribing' | 'done' | 'failed';
  transcript?: string;
  summary?: string;
  raw_content?: string;
  message?: string;
}

/** 推进一条「转写中」的 note 到下一状态（查任务 → 完成则取文本+总结+落库）。绝不抛出。 */
export async function advanceTranscription(
  db: Db,
  note: { id: string; userId: string; transcribeTaskId: string | null }
): Promise<TranscribeStatusResult> {
  const taskId = note.transcribeTaskId;
  if (!taskId) return { status: 'failed', message: '缺少转写任务号' };

  // 1) 查一次任务状态
  let chk;
  try {
    chk = await checkTranscription(taskId);
  } catch (err) {
    // 缺 key：保持「转写中」，待配置后由下次轮询/cron 推进，不误标失败。
    if (err instanceof AsrKeyMissingError) return { status: 'transcribing' };
    console.error('[transcribe] 查询任务异常（保持转写中）：', err);
    return { status: 'transcribing' };
  }

  if (chk.status === 'pending') return { status: 'transcribing' };

  if (chk.status === 'failed') {
    await markStatus(db, note, 'failed');
    return { status: 'failed', message: chk.message ?? '转写失败，音频已保存' };
  }

  // 2) done → 取整段文本（暂时性失败 → 留作 transcribing，下次再取）
  let text: string;
  try {
    text = await fetchTranscriptText(chk.transcriptionUrl ?? '');
  } catch (err) {
    console.error('[transcribe] 取转写结果失败（留待下次）：', err);
    return { status: 'transcribing' };
  }

  // 3) 写 transcript + 标 done（即便随后总结失败，转写也已落库 / 不再重复轮询）
  try {
    await db
      .update(notes)
      .set({ transcript: text, rawContent: text, transcribeStatus: 'done' })
      .where(and(eq(notes.id, note.id), eq(notes.userId, note.userId)));
  } catch (err) {
    console.error('[transcribe] 转写落库失败（留待下次）：', err);
    return { status: 'transcribing' };
  }

  // 4) 总结（会议纪要 / P8，按长度分流）——降级不影响 done；transcript 保持不动。
  const store: SummarizeStore = {
    async updateSummary(id, uid, patch) {
      const rows = await db
        .update(notes)
        .set({ summary: patch.summary, rawContent: patch.rawContent })
        .where(and(eq(notes.id, id), eq(notes.userId, uid)))
        .returning({ id: notes.id });
      return rows.length > 0;
    },
  };
  const sum = await summarizeTranscript(note.id, note.userId, text, {
    llm: createAnthropicClient(),
    store,
  });

  return {
    status: 'done',
    transcript: text,
    summary: sum.ok ? sum.summary : undefined,
    raw_content: sum.ok ? sum.rawContent : text,
  };
}

async function markStatus(
  db: Db,
  note: { id: string; userId: string },
  status: 'failed' | 'done'
): Promise<void> {
  try {
    await db
      .update(notes)
      .set({ transcribeStatus: status })
      .where(and(eq(notes.id, note.id), eq(notes.userId, note.userId)));
  } catch (err) {
    console.error('[transcribe] 更新转写状态失败：', err);
  }
}
