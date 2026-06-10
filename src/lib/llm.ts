/**
 * LLM 统一封装层（Anthropic Messages API）
 *
 * 约定：所有 LLM 调用必须经过本文件，统一做重试 / 日志 / 成本统计。
 * - json()：JSON 解析失败自动重试 1 次（附错误说明），再失败抛 LlmJsonError，由调用方标记 needs_review
 * - 每次调用的 token 消耗通过 logUsage 回调记录（默认 console）
 * - ANTHROPIC_API_KEY 缺失时抛 LlmKeyMissingError，调用入口负责返回明确错误，不崩溃
 */

// ============ 模型常量（可通过环境变量覆盖） ============

export const CLAUDE_MODELS = {
  /** P1 整理 / P2 制卡 / P4 日报 / P7 语音清洗 */
  haiku: process.env.MEMORY_CLAUDE_HAIKU ?? 'claude-3-5-haiku-latest',
  /** P3 关联确认（需要更强的判断力） */
  sonnet: process.env.MEMORY_CLAUDE_SONNET ?? 'claude-sonnet-4-5',
} as const;

export type ClaudeModelTier = keyof typeof CLAUDE_MODELS;

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 1500;

// ============ 错误类型 ============

export class LlmKeyMissingError extends Error {
  constructor(key = 'ANTHROPIC_API_KEY') {
    super(`未配置 ${key}，无法调用 LLM`);
    this.name = 'LlmKeyMissingError';
  }
}

export class LlmJsonError extends Error {
  readonly lastOutput: string;
  constructor(message: string, lastOutput: string) {
    super(message);
    this.name = 'LlmJsonError';
    this.lastOutput = lastOutput;
  }
}

// ============ 类型 ============

export interface LlmCallOpts {
  model: ClaudeModelTier;
  /** 任务标识，用于日志，如 'P1' / 'P3' */
  task: string;
  system?: string;
  maxTokens?: number;
}

export interface LlmUsage {
  task: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export type UsageLogger = (usage: LlmUsage) => void | Promise<void>;

export interface LlmClient {
  /** 纯文本输出（P4 Markdown、P7 清洗文本） */
  text(prompt: string, opts: LlmCallOpts): Promise<string>;
  /** JSON 输出，解析失败自动重试 1 次，再失败抛 LlmJsonError */
  json<T>(prompt: string, opts: LlmCallOpts): Promise<T>;
}

export type TextCompletionFn = (prompt: string, opts: LlmCallOpts) => Promise<string>;

// ============ JSON 宽松解析 ============

/** 容忍 ```json 围栏与前后杂讯，提取首个 JSON 对象/数组解析 */
export function parseJsonLoose<T>(raw: string): T {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  if (!text.startsWith('{') && !text.startsWith('[')) {
    const objStart = text.indexOf('{');
    const arrStart = text.indexOf('[');
    const start =
      objStart === -1 ? arrStart : arrStart === -1 ? objStart : Math.min(objStart, arrStart);
    if (start === -1) throw new SyntaxError('输出中未找到 JSON');
    const end = text.startsWith('{', start)
      ? text.lastIndexOf('}')
      : text.lastIndexOf(']');
    if (end <= start) throw new SyntaxError('输出中 JSON 不完整');
    text = text.slice(start, end + 1);
  }
  return JSON.parse(text) as T;
}

// ============ 客户端构造 ============

/**
 * 由底层文本补全函数构造 LlmClient（json 重试逻辑在此实现，便于脱离网络测试）
 */
export function buildLlmClient(complete: TextCompletionFn): LlmClient {
  return {
    text: complete,

    async json<T>(prompt: string, opts: LlmCallOpts): Promise<T> {
      const first = await complete(prompt, opts);
      try {
        return parseJsonLoose<T>(first);
      } catch (err1) {
        const errMsg = err1 instanceof Error ? err1.message : String(err1);
        const retryPrompt = `${prompt}

【系统提示】你上一次的输出无法解析为 JSON（错误：${errMsg}）。请重新输出，必须是合法 JSON，不要输出任何其他文字。`;
        const second = await complete(retryPrompt, opts);
        try {
          return parseJsonLoose<T>(second);
        } catch (err2) {
          const msg2 = err2 instanceof Error ? err2.message : String(err2);
          throw new LlmJsonError(
            `[${opts.task}] JSON 解析重试后仍失败：${msg2}`,
            second
          );
        }
      }
    },
  };
}

/** 创建基于 Anthropic API 的 LlmClient */
export function createAnthropicClient(options?: { logUsage?: UsageLogger }): LlmClient {
  const logUsage: UsageLogger =
    options?.logUsage ??
    ((u) =>
      console.log(
        `[llm] task=${u.task} model=${u.model} in=${u.inputTokens} out=${u.outputTokens}`
      ));

  const complete: TextCompletionFn = async (prompt, opts) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new LlmKeyMissingError();

    const model = CLAUDE_MODELS[opts.model];
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
        ...(opts.system ? { system: opts.system } : {}),
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(
        `Anthropic API ${res.status}（task=${opts.task}）：${detail.slice(0, 300)}`
      );
    }

    const data = (await res.json()) as {
      content: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    try {
      await logUsage({
        task: opts.task,
        model,
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      });
    } catch (err) {
      console.error('[llm] usage 日志写入失败：', err);
    }

    const text = data.content
      ?.filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
    if (!text) throw new Error(`Anthropic 返回空内容（task=${opts.task}）`);
    return text;
  };

  return buildLlmClient(complete);
}
