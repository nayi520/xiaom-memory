/**
 * P8 语音转写后即时加工：摘要 + 关键要点（+ 待办 + 涉及人/事/时间）。
 *
 * 与 P1（每晚批处理的结构化整理：分类/标签/概念）相区分：
 * P8 是**转写当下**的轻量即时加工，把要点/待办组织成可读 Markdown，给用户立刻可读的反馈。
 *
 * 设计要点（与既有契约/流水线兼容、无迁移）：
 * - 复用既有 LLM 客户端（fast 档 = haiku，配 DeepSeek 即用 DeepSeek）+ 既有 P8 prompt。
 * - 落库字段全部复用现有列，**不新增列、不迁移**：
 *     · note.summary      ← 2-3 句摘要（既有「AI 摘要」展示位直接用）
 *     · note.raw_content  ← 「AI 摘要 + 关键要点(+待办+涉及) + 转写原文」组织成的 Markdown
 *     · note.transcript   ← **保持原始转写不动**（关键！每晚 P7 清洗读它、P1 据清洗结果抽概念，
 *                            故不能覆盖，否则破坏流水线；用户的关键信息仍会进概念抽取）。
 * - 纯函数 + 注入式 store/llm，便于脱离网络/DB 单测；调用入口负责鉴权/配额/降级。
 */

import type { LlmClient } from '@/lib/llm';
import { GLOBAL_SYSTEM, buildP8Prompt, type P8Result } from './prompts';

/** 把 P8 结构化结果 + 转写原文组织成 note.raw_content 的 Markdown（清晰分节）。 */
export function buildSummaryMarkdown(_transcript: string, p8: P8Result): string {
  // 摘要存 note.summary（详情页「AI 摘要」卡片单独展示）、转写原文存 note.transcript
  //（详情页「查看原始转写」折叠区单独展示），故此处只组织「要点 / 待办 / 涉及」，避免重复渲染。
  const sections: string[] = [];

  const keyPoints = (p8.key_points ?? []).map((s) => s.trim()).filter(Boolean);
  if (keyPoints.length > 0) {
    sections.push(`## 🔑 关键要点\n\n${keyPoints.map((p) => `- ${p}`).join('\n')}`);
  }

  const todos = (p8.todos ?? []).map((s) => s.trim()).filter(Boolean);
  if (todos.length > 0) {
    sections.push(`## ✅ 待办 / 行动项\n\n${todos.map((t) => `- [ ] ${t}`).join('\n')}`);
  }

  const entities = (p8.entities ?? []).map((s) => s.trim()).filter(Boolean);
  if (entities.length > 0) {
    sections.push(`## 👥 涉及的人 / 事 / 时间\n\n${entities.map((e) => `- ${e}`).join('\n')}`);
  }

  return sections.join('\n\n');
}

/** summarizeTranscript 所需的最小 store 能力（仅按本人更新 note 的加工字段）。 */
export interface SummarizeStore {
  /**
   * 把摘要 + 加工后的 Markdown 写回 note（严格按 userId 归属过滤）。
   * 只更新 summary / raw_content，**不动 transcript**（保留原始转写给流水线）。
   * 返回是否命中该用户的 note（未命中 = 记录不存在/非本人）。
   */
  updateSummary(
    noteId: string,
    userId: string,
    patch: { summary: string; rawContent: string }
  ): Promise<boolean>;
}

export interface SummarizeResult {
  /** 是否成功产出并落库摘要。 */
  ok: boolean;
  /** 成功时的 2-3 句摘要（便于调用入口直接回给前端做即时反馈）。 */
  summary?: string;
  /** 成功时回写进 raw_content 的 Markdown（便于前端即时更新「最近记录」正文）。 */
  rawContent?: string;
  /** 失败/降级时的人类可读说明（缺 key / LLM 错误 / 内容为空 / 记录不存在）。 */
  message?: string;
}

/**
 * 对一段转写文本做 P8 加工并写回 note（摘要 + 关键要点等 → summary / raw_content）。
 *
 * **降级**：transcript 为空、LLM 缺 key 或任何 LLM/解析错误 → 返回 {ok:false, message}，
 * **绝不抛出**，由调用入口决定如何呈现（转写仍在、不报错）。store 写库失败同样 fail-soft。
 *
 * @param noteId     目标 note id
 * @param userId     当前登录用户 id（store 据此严格归属过滤）
 * @param transcript 转写原文（来自 note.transcript / ASR 刚产出的文本）
 * @param deps       注入的 llm 客户端 + store
 */
export async function summarizeTranscript(
  noteId: string,
  userId: string,
  transcript: string,
  deps: { llm: LlmClient; store: SummarizeStore }
): Promise<SummarizeResult> {
  const text = (transcript ?? '').trim();
  if (!text) {
    return { ok: false, message: '没有可用于总结的转写文本' };
  }

  let p8: P8Result;
  try {
    p8 = await deps.llm.json<P8Result>(buildP8Prompt({ transcript: text }), {
      model: 'haiku', // fast 档（配 DeepSeek 即 deepseek-chat），与 P1/P7 同档
      task: 'P8',
      system: GLOBAL_SYSTEM,
    });
  } catch (err) {
    // 缺 key / HTTP / JSON 解析重试后仍失败：降级——不报错，保留转写。
    const message = err instanceof Error ? err.message : String(err);
    console.error('[P8] 转写总结失败（降级，保留转写）：', message);
    return { ok: false, message: 'AI 总结暂不可用，已保留转写' };
  }

  const summary = (p8.summary ?? '').trim();
  // summary 必填；模型偶发给空时，降级回退（避免落空摘要冲掉 UI 上的转写）。
  if (!summary) {
    return { ok: false, message: 'AI 总结未产出摘要，已保留转写' };
  }

  // 结构化要点为空(模型只给了摘要)时,回退保留转写文本,避免 raw_content 被清空(流水线/搜索仍可读)。
  const rawContent = buildSummaryMarkdown(text, p8) || text;

  try {
    const hit = await deps.store.updateSummary(noteId, userId, {
      summary,
      rawContent,
    });
    if (!hit) {
      return { ok: false, message: '记录不存在或非本人' };
    }
  } catch (err) {
    console.error('[P8] 总结结果写库失败：', err instanceof Error ? err.message : err);
    return { ok: false, message: '总结结果保存失败，已保留转写' };
  }

  return { ok: true, summary, rawContent };
}
