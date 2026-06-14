/**
 * RAG 问答服务（P6）—— 召回 → 拼上下文 → LLM 基于检索作答
 *
 * 流程（与 /api/ask 对接）：
 *   embed(question) 由调用方传入向量 → retrieveConcepts 余弦召回 top-K（严格 userId 过滤）
 *   → buildAskContext 拼成带编号的检索上下文 → buildP6Prompt → llm.text(model:'sonnet', task:'P6')
 *   → 返回 { answer, sources:[{conceptId,title,snippet}] }。
 *
 * 设计要点：
 *   - 检索为空时**不调 LLM**，直接回固定文案（省成本，且严守"检索不到就说不知道"）。
 *   - 上下文与 sources 顺序一致、编号一致（P6 用 [1][2] 角标，sources 即编号 1..N 的概念）。
 *   - 纯函数 buildAskContext / makeSnippet 抽出，便于脱离网络与库测试。
 */

import type { Database } from '@/lib/db/client';
import type { LlmClient } from '@/lib/llm';
import { buildP6Prompt } from '@/features/digest/prompts';
import {
  retrieveConcepts,
  type RetrievedConcept,
  ASK_TOP_K,
  ASK_SIMILARITY_THRESHOLD,
} from './retrieval';

// ============ 类型 ============

export interface AskSource {
  conceptId: string;
  title: string;
  /** 简短摘要（概念解释/关联记录，给来源卡片展示） */
  snippet: string;
}

export interface AskResult {
  answer: string;
  sources: AskSource[];
}

/** 检索为空时的固定回答（不调 LLM，杜绝编造） */
export const NO_CONTEXT_ANSWER =
  '你的知识库里暂时没有和这个问题相关的记录。等你记录并整理过相关内容后，我就能基于它来回答了。';

/** 来源卡片摘要最大字数 */
const SOURCE_SNIPPET_MAX = 120;

// ============ 纯函数：上下文 / 摘要 ============

/** 概念 → 来源卡片摘要：优先概念解释，回退关联记录摘要 */
export function makeSnippet(c: RetrievedConcept): string {
  const base = (c.summary || c.noteSnippet || '').replace(/\s+/g, ' ').trim();
  if (!base) return '';
  return base.length > SOURCE_SNIPPET_MAX
    ? `${base.slice(0, SOURCE_SNIPPET_MAX)}…`
    : base;
}

/**
 * 拼检索上下文：每条形如「[1] 概念名：解释（相关记录：…）」，按召回顺序编号。
 * 编号与 sources 数组下标 +1 对齐，供 P6 角标引用。
 */
export function buildAskContext(concepts: RetrievedConcept[]): string {
  return concepts
    .map((c, i) => {
      const explanation = (c.summary ?? '').replace(/\s+/g, ' ').trim();
      const note = c.noteSnippet ? `（相关记录：${c.noteSnippet}）` : '';
      const body = explanation || '（暂无解释）';
      return `[${i + 1}] ${c.title}：${body}${note}`;
    })
    .join('\n');
}

// ============ 主服务 ============

export interface AskDeps {
  db: Database;
  llm: LlmClient;
  /** 已计算好的问题向量（调用方负责 embed，便于在缺 key 时于入口降级） */
  questionEmbedding: number[];
  topK?: number;
  threshold?: number;
}

/**
 * 执行一次问答。检索为空直接返回固定文案（不调用 LLM）。
 * 严格按 userId 过滤检索（retrieveConcepts 内 where user_id）。
 */
export async function answerQuestion(
  userId: string,
  question: string,
  deps: AskDeps
): Promise<AskResult> {
  const concepts = await retrieveConcepts(
    deps.db,
    userId,
    deps.questionEmbedding,
    deps.topK ?? ASK_TOP_K,
    deps.threshold ?? ASK_SIMILARITY_THRESHOLD
  );

  const sources: AskSource[] = concepts.map((c) => ({
    conceptId: c.conceptId,
    title: c.title,
    snippet: makeSnippet(c),
  }));

  if (concepts.length === 0) {
    return { answer: NO_CONTEXT_ANSWER, sources: [] };
  }

  const context = buildAskContext(concepts);
  const answer = await deps.llm.text(
    buildP6Prompt({ question, context }),
    { model: 'sonnet', task: 'P6' }
  );

  return { answer: answer.trim(), sources };
}

export { retrieveConcepts, ASK_TOP_K, ASK_SIMILARITY_THRESHOLD } from './retrieval';
export type { RetrievedConcept } from './retrieval';
