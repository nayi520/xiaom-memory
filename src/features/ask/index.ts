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
import { buildP6Prompt, type P6Turn } from '@/features/digest/prompts';
import {
  retrieveConcepts,
  type RetrievedConcept,
  ASK_TOP_K,
  ASK_SIMILARITY_THRESHOLD,
} from './retrieval';

// ============ 类型 ============

export interface AskSource {
  /** 角标编号（1..N），与答案中的 [n] 一致 */
  n: number;
  conceptId: string;
  title: string;
  /** 简短摘要（概念解释/关联记录，给来源卡片展示） */
  snippet: string;
}

export interface AskResult {
  answer: string;
  sources: AskSource[];
  /** 追问建议（由检索到的概念派生，2~3 个；无来源时为空） */
  suggestions: string[];
}

/** 一轮对话历史（多轮上下文） */
export type AskTurn = P6Turn;

/** 检索为空时的固定回答（不调 LLM，杜绝编造） */
export const NO_CONTEXT_ANSWER =
  '你的知识库里暂时没有和这个问题相关的记录。等你记录并整理过相关内容后，我就能基于它来回答了。';

/** 来源卡片摘要最大字数 */
const SOURCE_SNIPPET_MAX = 120;

/** 多轮上下文限制：最多带最近 N 轮、每条最多 M 字（控成本、防注入超长） */
export const ASK_HISTORY_MAX_TURNS = 6;
export const ASK_HISTORY_MAX_CHARS = 500;
/** 追问建议条数 */
export const ASK_SUGGESTION_COUNT = 3;

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

/** 概念 → 带编号 sources（n 与答案 [n] 角标一致） */
export function toSources(concepts: RetrievedConcept[]): AskSource[] {
  return concepts.map((c, i) => ({
    n: i + 1,
    conceptId: c.conceptId,
    title: c.title,
    snippet: makeSnippet(c),
  }));
}

/**
 * 截断多轮历史：仅保留最近 ASK_HISTORY_MAX_TURNS 轮，每条压空白并截 ASK_HISTORY_MAX_CHARS 字，
 * 过滤空内容/非法 role。控成本、稳上下文。纯函数，便于测试。
 */
export function clampHistory(history?: AskTurn[]): AskTurn[] {
  if (!Array.isArray(history)) return [];
  return history
    .filter(
      (t): t is AskTurn =>
        !!t &&
        (t.role === 'user' || t.role === 'assistant') &&
        typeof t.content === 'string' &&
        t.content.trim().length > 0
    )
    .slice(-ASK_HISTORY_MAX_TURNS)
    .map((t) => {
      const content = t.content.replace(/\s+/g, ' ').trim();
      return {
        role: t.role,
        content:
          content.length > ASK_HISTORY_MAX_CHARS
            ? `${content.slice(0, ASK_HISTORY_MAX_CHARS)}…`
            : content,
      };
    });
}

/**
 * 由检索到的概念派生追问建议（不额外调 LLM，零成本、稳定）。
 * 取相关度最高的前若干概念名，套用启发式追问模板；概念名去重。
 */
export function deriveSuggestions(
  concepts: RetrievedConcept[],
  count: number = ASK_SUGGESTION_COUNT
): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const c of concepts) {
    const name = c.title.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
    if (names.length >= count) break;
  }
  // 模板交替，避免每条都长得一样；与「问自己知识库」语气一致。
  const templates = [
    (n: string) => `再多讲讲「${n}」`,
    (n: string) => `「${n}」和我记过的别的概念有什么关联？`,
    (n: string) => `我还记过哪些和「${n}」相关的内容？`,
  ];
  return names.map((n, i) => templates[i % templates.length](n));
}

// ============ 主服务 ============

export interface AskDeps {
  db: Database;
  llm: LlmClient;
  /** 已计算好的问题向量（调用方负责 embed，便于在缺 key 时于入口降级） */
  questionEmbedding: number[];
  /** 多轮对话历史（可选）；内部会截断轮数/长度后拼入 P6 上下文 */
  history?: AskTurn[];
  topK?: number;
  threshold?: number;
}

/** 召回 + 构造 sources/suggestions（流式与非流式共用） */
async function prepareAsk(userId: string, deps: AskDeps) {
  const concepts = await retrieveConcepts(
    deps.db,
    userId,
    deps.questionEmbedding,
    deps.topK ?? ASK_TOP_K,
    deps.threshold ?? ASK_SIMILARITY_THRESHOLD
  );
  return {
    concepts,
    sources: toSources(concepts),
    suggestions: concepts.length > 0 ? deriveSuggestions(concepts) : [],
  };
}

/**
 * 执行一次问答（非流式）。检索为空直接返回固定文案（不调用 LLM）。
 * 严格按 userId 过滤检索（retrieveConcepts 内 where user_id）。
 * 注：返回结构在既有 { answer, sources } 基础上**新增** suggestions（向后兼容，旧字段不变）。
 */
export async function answerQuestion(
  userId: string,
  question: string,
  deps: AskDeps
): Promise<AskResult> {
  const { concepts, sources, suggestions } = await prepareAsk(userId, deps);

  if (concepts.length === 0) {
    return { answer: NO_CONTEXT_ANSWER, sources: [], suggestions: [] };
  }

  const context = buildAskContext(concepts);
  const answer = await deps.llm.text(
    buildP6Prompt({ question, context, history: clampHistory(deps.history) }),
    { model: 'sonnet', task: 'P6' }
  );

  return { answer: answer.trim(), sources, suggestions };
}

/** 流式问答事件（与 /api/ask SSE 帧一一对应） */
export type AskStreamEvent =
  | { type: 'sources'; sources: AskSource[] }
  | { type: 'token'; text: string }
  | { type: 'suggestions'; suggestions: string[] }
  | { type: 'done' };

/**
 * 执行一次问答（流式）。产出顺序：先 sources，再逐 token，最后（如有）suggestions、done。
 * 检索为空时不调 LLM，把固定文案作为单个 token 产出，仍按相同协议收尾。
 * token 透传自 llm.textStream（DashScope SSE）。
 */
export async function* answerQuestionStream(
  userId: string,
  question: string,
  deps: AskDeps
): AsyncGenerator<AskStreamEvent> {
  const { concepts, sources, suggestions } = await prepareAsk(userId, deps);

  yield { type: 'sources', sources };

  if (concepts.length === 0) {
    yield { type: 'token', text: NO_CONTEXT_ANSWER };
    yield { type: 'done' };
    return;
  }

  const context = buildAskContext(concepts);
  const prompt = buildP6Prompt({
    question,
    context,
    history: clampHistory(deps.history),
  });
  for await (const chunk of deps.llm.textStream(prompt, { model: 'sonnet', task: 'P6' })) {
    if (chunk) yield { type: 'token', text: chunk };
  }

  if (suggestions.length > 0) yield { type: 'suggestions', suggestions };
  yield { type: 'done' };
}

export { retrieveConcepts, ASK_TOP_K, ASK_SIMILARITY_THRESHOLD } from './retrieval';
export type { RetrievedConcept } from './retrieval';
