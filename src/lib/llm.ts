/**
 * LLM 统一封装层（去 Supabase 改造：DashScope 通义千问 · OpenAI 兼容接口）
 *
 * 约定：所有 LLM 调用必须经过本文件，统一做重试 / 日志 / 成本统计。
 * - json()：JSON 解析失败自动重试 1 次（附错误说明），再失败抛 LlmJsonError，由调用方标记 needs_review
 * - 每次调用的 token 消耗通过 logUsage 回调记录（默认 console）
 * - DASHSCOPE_API_KEY 缺失时抛 LlmKeyMissingError，调用入口负责返回明确错误，不崩溃
 *
 * 迁移说明（原 Anthropic → 通义千问）：
 * - 走 DashScope OpenAI 兼容端点（base_url + /chat/completions），仅换 base_url / key / 模型名。
 * - **导出函数签名保持不变**（createAnthropicClient / buildLlmClient / parseJsonLoose 等），
 *   digest pipeline 等调用方零改动。模型层 tier 仍是 'haiku' / 'sonnet'，但映射到 Qwen 模型。
 * - JSON 输出用 response_format:{type:'json_object'}（仅 json() 路径，text() 输出 Markdown 不设）。
 *   通义不支持 json_schema，故约束字段示例写在 prompt 内（见 features/digest/prompts.ts）；
 *   且兼容接口要求消息中含 "JSON" 字样（GLOBAL_SYSTEM 与各 prompt 已满足）。
 * - **不设 max_tokens**（防止长 JSON / Markdown 被截断）。
 */

// ============ 模型常量（可通过环境变量覆盖） ============
// tier 名沿用 'haiku' / 'sonnet' 以保持调用方与测试不变；值映射到通义千问模型：
//   - haiku  → 主力 qwen-plus（P1 整理 / P2 制卡 / P4 日报 / P7 语音清洗）
//   - sonnet → 质量敏感 qwen-max（P3 关联确认，需要更强判断力）
export const CLAUDE_MODELS = {
  /** P1 整理 / P2 制卡 / P4 日报 / P7 语音清洗 —— 主力 qwen-plus */
  haiku: process.env.MEMORY_QWEN_PLUS ?? process.env.MEMORY_CLAUDE_HAIKU ?? 'qwen-plus',
  /** P3 关联确认（需要更强的判断力）—— qwen-max */
  sonnet: process.env.MEMORY_QWEN_MAX ?? process.env.MEMORY_CLAUDE_SONNET ?? 'qwen-max',
} as const;

export type ClaudeModelTier = keyof typeof CLAUDE_MODELS;

/** DashScope OpenAI 兼容端点（base_url） */
const DASHSCOPE_BASE_URL =
  process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DASHSCOPE_CHAT_URL = `${DASHSCOPE_BASE_URL}/chat/completions`;

// ============ 错误类型 ============

export class LlmKeyMissingError extends Error {
  constructor(key = 'DASHSCOPE_API_KEY') {
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
  /**
   * 是否要求模型输出 JSON 对象（response_format:json_object）。
   * 由 buildLlmClient.json() 内部置 true；text() 路径保持 false（输出 Markdown/纯文本）。
   * 可选字段，对现有调用方与测试完全向后兼容。
   */
  jsonMode?: boolean;
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
  /**
   * 流式文本输出（V9 问答 SSE）：逐 token 产出 Markdown/纯文本片段。
   * createAnthropicClient 走 DashScope stream:true 透传；
   * 由 buildLlmClient 构造的客户端（如测试 mock）回退为「一次性产出整段」，
   * 行为与 text() 等价，便于脱离网络测试，调用方无需区分。
   */
  textStream(prompt: string, opts: LlmCallOpts): AsyncIterable<string>;
}

export type TextCompletionFn = (prompt: string, opts: LlmCallOpts) => Promise<string>;
/** 底层流式补全：逐片段产出文本（DashScope SSE 透传用）。可选，缺省回退非流式。 */
export type StreamCompletionFn = (
  prompt: string,
  opts: LlmCallOpts
) => AsyncIterable<string>;

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
 * 由底层文本补全函数构造 LlmClient（json 重试逻辑在此实现，便于脱离网络测试）。
 *
 * @param complete 必填，非流式文本补全。
 * @param stream   选填，底层流式补全。未提供时 textStream() 回退为「调 complete 取整段、
 *                 一次性产出」，行为与 text() 等价——保证旧调用方与 mock 测试零改动。
 */
export function buildLlmClient(
  complete: TextCompletionFn,
  stream?: StreamCompletionFn
): LlmClient {
  return {
    text: (prompt, opts) => complete(prompt, opts),

    textStream(prompt, opts): AsyncIterable<string> {
      if (stream) return stream(prompt, opts);
      // 回退：无底层流式实现时，取整段后一次性产出（测试 mock / 旧路径仍可用）。
      return (async function* () {
        const full = await complete(prompt, opts);
        if (full) yield full;
      })();
    },

    async json<T>(prompt: string, opts: LlmCallOpts): Promise<T> {
      // 标记 jsonMode，让底层 complete 启用 response_format:json_object
      const jsonOpts: LlmCallOpts = { ...opts, jsonMode: true };
      const first = await complete(prompt, jsonOpts);
      try {
        return parseJsonLoose<T>(first);
      } catch (err1) {
        const errMsg = err1 instanceof Error ? err1.message : String(err1);
        const retryPrompt = `${prompt}

【系统提示】你上一次的输出无法解析为 JSON（错误：${errMsg}）。请重新输出，必须是合法 JSON，不要输出任何其他文字。`;
        const second = await complete(retryPrompt, jsonOpts);
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

/**
 * 创建基于 DashScope（通义千问 · OpenAI 兼容）的 LlmClient。
 * 名称沿用 createAnthropicClient 以保持调用方不变（src/app/api/**），内部已切到通义千问。
 */
export function createAnthropicClient(options?: { logUsage?: UsageLogger }): LlmClient {
  const logUsage: UsageLogger =
    options?.logUsage ??
    ((u) =>
      console.log(
        `[llm] task=${u.task} model=${u.model} in=${u.inputTokens} out=${u.outputTokens}`
      ));

  // 构造 DashScope 请求体（complete / stream 共用）。
  function buildRequestBody(prompt: string, opts: LlmCallOpts): Record<string, unknown> {
    const model = CLAUDE_MODELS[opts.model];
    // OpenAI 兼容消息：system（可选）+ user。json() 路径已确保 prompt/system 含 "JSON" 字样。
    const messages: { role: 'system' | 'user'; content: string }[] = [];
    if (opts.system) messages.push({ role: 'system', content: opts.system });
    messages.push({ role: 'user', content: prompt });

    const body: Record<string, unknown> = { model, messages };
    // 仅 JSON 任务设 response_format（text() 输出 Markdown/纯文本不能设）。
    if (opts.jsonMode) body.response_format = { type: 'json_object' };
    // 注意：不设 max_tokens，避免长输出被截断。
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    return body;
  }

  const complete: TextCompletionFn = async (prompt, opts) => {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) throw new LlmKeyMissingError();

    const model = CLAUDE_MODELS[opts.model];
    const body = buildRequestBody(prompt, opts);

    const res = await fetch(DASHSCOPE_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(
        `DashScope API ${res.status}（task=${opts.task}）：${detail.slice(0, 300)}`
      );
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    try {
      await logUsage({
        task: opts.task,
        model,
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      });
    } catch (err) {
      console.error('[llm] usage 日志写入失败：', err);
    }

    const text = data.choices?.[0]?.message?.content ?? '';
    if (!text) throw new Error(`通义千问返回空内容（task=${opts.task}）`);
    return text;
  };

  // 流式补全：DashScope OpenAI 兼容 SSE（stream:true），逐 chunk 透传 delta.content。
  // 每行 `data: {json}`，以 `data: [DONE]` 结束；用量在 stream_options 末帧回报（best-effort 记录）。
  const stream: StreamCompletionFn = (prompt, opts) =>
    (async function* () {
      const apiKey = process.env.DASHSCOPE_API_KEY;
      if (!apiKey) throw new LlmKeyMissingError();

      const model = CLAUDE_MODELS[opts.model];
      const body = {
        ...buildRequestBody(prompt, opts),
        stream: true,
        // 让末帧带 usage，便于成本统计（兼容端点支持；不支持则忽略，不影响透传）。
        stream_options: { include_usage: true },
      };

      const res = await fetch(DASHSCOPE_CHAT_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok || !res.body) {
        const detail = res.body ? await res.text() : '';
        throw new Error(
          `DashScope API ${res.status}（task=${opts.task}，stream）：${detail.slice(0, 300)}`
        );
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // 按行解析 SSE：累计到换行才处理，剩余半行留在 buffer。
          let nl: number;
          while ((nl = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line || !line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') {
              buffer = '';
              break;
            }
            let evt: {
              choices?: { delta?: { content?: string } }[];
              usage?: { prompt_tokens?: number; completion_tokens?: number };
            };
            try {
              evt = JSON.parse(payload);
            } catch {
              continue; // 跳过无法解析的心跳/注释行
            }
            if (evt.usage) usage = evt.usage;
            const delta = evt.choices?.[0]?.delta?.content;
            if (delta) yield delta;
          }
        }
      } finally {
        reader.releaseLock();
      }

      try {
        await logUsage({
          task: opts.task,
          model,
          inputTokens: usage?.prompt_tokens ?? 0,
          outputTokens: usage?.completion_tokens ?? 0,
        });
      } catch (err) {
        console.error('[llm] usage 日志写入失败：', err);
      }
    })();

  return buildLlmClient(complete, stream);
}
