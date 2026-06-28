/**
 * LLM 统一封装层（多供应商：DashScope 通义千问 / DeepSeek / OpenAI / Moonshot / 智谱 / custom · OpenAI 兼容接口）
 *
 * 约定：所有 LLM 调用必须经过本文件，统一做重试 / 日志 / 成本统计。
 * - json()：JSON 解析失败自动重试 1 次（附错误说明），再失败抛 LlmJsonError，由调用方标记 needs_review
 * - 每次调用的 token 消耗通过 logUsage 回调记录（默认 console）
 * - 当前 provider 的 API Key 缺失时抛 LlmKeyMissingError，调用入口负责返回明确错误，不崩溃
 *
 * 多供应商（env `LLM_PROVIDER`，默认 dashscope；见 src/lib/providers.ts）：
 * - 所有 provider 均走 OpenAI 兼容端点（base_url + /chat/completions），仅换 base_url / key / 模型名。
 * - **默认 DashScope 行为像素级不变**：不填新 env 时 base_url / 模型名 / key env（DASHSCOPE_API_KEY）
 *   与改造前逐字一致；既有覆盖（MEMORY_QWEN_PLUS/MAX、DASHSCOPE_BASE_URL）继续生效。
 * - **导出函数/类型签名保持不变**（createAnthropicClient / buildLlmClient / parseJsonLoose /
 *   CLAUDE_MODELS / ClaudeModelTier / QWEN_VL_MODEL 等），digest pipeline 等调用方与测试零改动。
 *   模型层 tier 仍是 'haiku'(fast) / 'sonnet'(strong)，映射到当前 provider 的两档模型。
 * - JSON 输出用 response_format:{type:'json_object'}（仅 json() 路径，text() 输出 Markdown 不设）。
 *   兼容端点要求消息中含 "JSON" 字样（GLOBAL_SYSTEM 与各 prompt 已满足）。
 * - **不设 max_tokens**（防止长 JSON / Markdown 被截断）。
 */

import {
  resolveLlmProvider,
  resolveLlmJsonMode,
  resolveVisionProvider,
  type LlmProviderConfig,
} from './providers';

// ============ 模型常量（tier → 当前 provider 模型，env 可覆盖） ============
// tier 名沿用 'haiku'(fast) / 'sonnet'(strong) 以保持调用方与测试不变；
// 值在模块加载时由当前 provider 解析（默认 DashScope：haiku→qwen-plus、sonnet→qwen-max）：
//   - haiku  → 主力/fast 档（P1 整理 / P2 制卡 / P4 日报 / P7 语音清洗）
//   - sonnet → 质量敏感/strong 档（P3 关联确认，需要更强判断力）
// 说明：仅是「tier→模型名」的对外快照，实际请求每次 resolveLlmProvider() 取最新配置，
//       以便测试 / 运行时改 env 后即时生效，且保持与 DashScope 缺省逐字一致。
const _llmCfgAtLoad = resolveLlmProvider();
export const CLAUDE_MODELS = {
  /** P1 整理 / P2 制卡 / P4 日报 / P7 语音清洗 —— fast 档 */
  haiku: _llmCfgAtLoad.models.fast,
  /** P3 关联确认（需要更强的判断力）—— strong 档 */
  sonnet: _llmCfgAtLoad.models.strong,
} as const;

export type ClaudeModelTier = keyof typeof CLAUDE_MODELS;

/** tier → 当前 provider 的实际模型名（每次取最新 env 配置）。 */
function modelForTier(cfg: LlmProviderConfig, tier: ClaudeModelTier): string {
  return tier === 'sonnet' ? cfg.models.strong : cfg.models.fast;
}

/**
 * 图片 OCR 多模态模型（V13 图片捕获）。
 * 默认 DashScope qwen-vl-plus（MEMORY_QWEN_VL 可覆盖）；VISION_PROVIDER=openai 时为 gpt-4o（vision）。
 * 走 OpenAI 兼容 /chat/completions 端点，消息 content 用「图文混排数组」（{type:'image_url'} + {type:'text'}）。
 * 导出为对外快照（加载时解析）；实际请求每次取最新 resolveVisionProvider()。
 */
export const QWEN_VL_MODEL = resolveVisionProvider().model;

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

/** 图片 OCR（qwen-vl 多模态）调用失败（HTTP / 业务错误）。调用入口据此优雅降级。 */
export class LlmVisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmVisionError';
  }
}

/**
 * Chat 补全 HTTP 非 2xx 错误（带状态码 + 响应体），便于上层判定是否触发 json 自动回退。
 * message 与改造前逐字一致（`LLM API(provider) status（task=…）：<detail 前 300 字>`），
 * 故既有「按 message 透出/降级」的调用方与日志不受影响。
 */
export class LlmHttpError extends Error {
  readonly status: number;
  readonly task: string;
  /** 原始响应体（用于 isResponseFormatUnsupported 判定；message 里只截前 300 字）。 */
  readonly detail: string;
  constructor(provider: string, status: number, task: string, detail: string) {
    super(`LLM API(${provider}) ${status}（task=${task}）：${(detail || '').slice(0, 300)}`);
    this.name = 'LlmHttpError';
    this.status = status;
    this.task = task;
    this.detail = detail || '';
  }
}

// ============ json 模式自动回退：判定「该不该去掉 response_format 重试」 ============

/**
 * 判断一次 HTTP 400 是否「疑似因 response_format / 不支持的参数」导致——用于 jsonMode 自动回退。
 *
 * 触发条件（保守，避免吞掉真正的内容错误）：响应体（小写后）含以下任一关键字。
 * 覆盖常见 OpenAI 兼容供应商对不支持 `response_format` 的报错措辞（含中英文）。
 * 注：调用处仅在 **jsonMode && HTTP 400** 时才会询问本函数；非 400 / 非 jsonMode 一律不回退。
 */
export function isResponseFormatUnsupported(status: number, body: string): boolean {
  if (status !== 400) return false;
  const b = (body || '').toLowerCase();
  return (
    b.includes('response_format') ||
    b.includes('json_object') ||
    b.includes('json mode') ||
    b.includes('unsupported parameter') ||
    b.includes('unknown parameter') ||
    b.includes('unrecognized') ||
    b.includes('invalid parameter') ||
    b.includes('not supported') ||
    b.includes("doesn't support") ||
    b.includes('does not support') ||
    b.includes('不支持')
  );
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
 * 创建当前 provider（默认 DashScope · OpenAI 兼容）的 LlmClient。
 * 名称沿用 createAnthropicClient 以保持调用方不变（src/app/api/**）；
 * provider 由 env LLM_PROVIDER 决定（默认 dashscope，逐字保旧行为），见 src/lib/providers.ts。
 */
export function createAnthropicClient(options?: { logUsage?: UsageLogger }): LlmClient {
  const logUsage: UsageLogger =
    options?.logUsage ??
    ((u) =>
      console.log(
        `[llm] task=${u.task} model=${u.model} in=${u.inputTokens} out=${u.outputTokens}`
      ));

  // 构造请求体（complete / stream 共用）。模型名来自当前 provider 配置。
  //
  // @param withResponseFormat 是否在 jsonMode 下带 response_format:{type:'json_object'}。
  //   缺省由 LLM_JSON_MODE 决定（auto/on→带，off→不带）；自动回退时调用方显式传 false。
  function buildRequestBody(
    cfg: LlmProviderConfig,
    prompt: string,
    opts: LlmCallOpts,
    withResponseFormat?: boolean
  ): Record<string, unknown> {
    const model = modelForTier(cfg, opts.model);
    // OpenAI 兼容消息：system（可选）+ user。json() 路径已确保 prompt/system 含 "JSON" 字样。
    const messages: { role: 'system' | 'user'; content: string }[] = [];
    if (opts.system) messages.push({ role: 'system', content: opts.system });
    messages.push({ role: 'user', content: prompt });

    const body: Record<string, unknown> = { model, messages };
    // 仅 JSON 任务设 response_format（text() 输出 Markdown/纯文本不能设）。
    // LLM_JSON_MODE=off 时从不带（直接靠 prompt）；auto/on 带；回退路径显式传 false 去掉。
    const useResponseFormat = withResponseFormat ?? resolveLlmJsonMode() !== 'off';
    if (opts.jsonMode && useResponseFormat) {
      body.response_format = { type: 'json_object' };
    }
    // 注意：不设 max_tokens，避免长输出被截断。
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    return body;
  }

  const complete: TextCompletionFn = async (prompt, opts) => {
    const cfg = resolveLlmProvider();
    if (!cfg.apiKey) throw new LlmKeyMissingError(cfg.apiKeyEnv);

    const model = modelForTier(cfg, opts.model);

    // 发一次 POST 并返回模型文本。withResponseFormat 控制 jsonMode 下是否带 response_format。
    // HTTP 非 2xx → 抛 LlmHttpError（带 status + 响应体），便于上层判定是否触发 json 回退。
    const postOnce = async (withResponseFormat: boolean): Promise<string> => {
      const body = buildRequestBody(cfg, prompt, opts, withResponseFormat);
      const res = await fetch(cfg.chatUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const detail = await res.text();
        throw new LlmHttpError(cfg.provider, res.status, opts.task, detail);
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

    // LLM_JSON_MODE：auto=带 response_format + 失败回退；on=带不回退；off=本就不带。
    const jsonMode = resolveLlmJsonMode();
    const wantResponseFormat = !!opts.jsonMode && jsonMode !== 'off';

    try {
      return await postOnce(wantResponseFormat);
    } catch (err) {
      // 自动回退：仅当「带了 response_format（jsonMode 且 auto）」且本次是 response_format/参数类 400，
      // 才去掉 response_format 重试一次（prompt 已含「输出合法 JSON」，json() 外层另有解析重试兜底）。
      // on 模式不回退；off 模式本就没带；非 400 / 非该类报错照常抛（走既有降级）。
      if (
        wantResponseFormat &&
        jsonMode === 'auto' &&
        err instanceof LlmHttpError &&
        isResponseFormatUnsupported(err.status, err.detail)
      ) {
        console.warn(
          `[llm] ${cfg.provider} 疑似不支持 response_format（task=${opts.task}，HTTP 400），去掉后重试一次`
        );
        return await postOnce(false);
      }
      throw err;
    }
  };

  // 流式补全：OpenAI 兼容 SSE（stream:true），逐 chunk 透传 delta.content。
  // 每行 `data: {json}`，以 `data: [DONE]` 结束；用量在 stream_options 末帧回报（best-effort 记录）。
  const stream: StreamCompletionFn = (prompt, opts) =>
    (async function* () {
      const cfg = resolveLlmProvider();
      if (!cfg.apiKey) throw new LlmKeyMissingError(cfg.apiKeyEnv);

      const model = modelForTier(cfg, opts.model);
      const body = {
        ...buildRequestBody(cfg, prompt, opts),
        stream: true,
        // 让末帧带 usage，便于成本统计（兼容端点支持；不支持则忽略，不影响透传）。
        stream_options: { include_usage: true },
      };

      const res = await fetch(cfg.chatUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok || !res.body) {
        const detail = res.body ? await res.text() : '';
        throw new Error(
          `LLM API(${cfg.provider}) ${res.status}（task=${opts.task}，stream）：${detail.slice(0, 300)}`
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

// ============ 图片 OCR（V13 图片捕获 · 视觉多模态，默认 qwen-vl） ============

/** OCR 默认提示词：忠实抽取图片中的文字，不臆造、不翻译、不解读。 */
const OCR_PROMPT_DEFAULT =
  '请提取这张图片中的所有文字内容，按从上到下、从左到右的自然阅读顺序输出为纯文本。' +
  '保留原有的换行与段落结构。只输出图片里实际存在的文字，不要翻译、不要解释、不要补充任何图片中没有的内容。' +
  '如果图片中没有任何文字，则只回复"（图片中未识别到文字）"。';

export interface OcrOpts {
  /** 自定义提示词（默认忠实抽取文字）。 */
  prompt?: string;
  /** 任务标识，用于用量日志（默认 'OCR'）。 */
  task?: string;
  /** 用量记录回调（默认 console）。 */
  logUsage?: UsageLogger;
}

/**
 * 用视觉多模态模型对一张「公网可访问的图片 URL」做 OCR（图片转文字），返回整段文本。
 *
 * provider 由 env VISION_PROVIDER 决定（默认 dashscope qwen-vl-plus；可设 openai gpt-4o），见 src/lib/providers.ts。
 * 形态对齐 transcribe/funasr：调用方先把图片落 OSS 并拿到签名 URL，再把 URL 交给本函数；
 * 走 OpenAI 兼容 /chat/completions，单条 user 消息的 content 为「图文混排数组」（OpenAI/DashScope 一致）。
 *
 * @param imageUrl 公网可访问的图片 URL（http/https；调用方用 OSS 签名 URL）
 * @param opts     提示词 / 任务名 / 用量回调（可选）
 * @returns        { text } OCR 出的纯文本（可能为空串——纯图无字时由调用方决定如何呈现）
 * @throws LlmKeyMissingError 未配置当前 vision provider 的 API Key（调用入口应据此优雅降级）
 * @throws LlmVisionError     提交失败 / HTTP 错误 / 返回异常
 */
export async function ocrImageUrl(
  imageUrl: string,
  opts: OcrOpts = {}
): Promise<{ text: string }> {
  const cfg = resolveVisionProvider();
  if (!cfg.apiKey) throw new LlmKeyMissingError(cfg.apiKeyEnv);

  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
    throw new LlmVisionError(
      `OCR 需要公网可访问的图片 URL（http/https），收到：${String(imageUrl).slice(0, 120)}`
    );
  }

  const task = opts.task ?? 'OCR';
  const prompt = opts.prompt ?? OCR_PROMPT_DEFAULT;
  const logUsage: UsageLogger =
    opts.logUsage ??
    ((u) =>
      console.log(
        `[llm] task=${u.task} model=${u.model} in=${u.inputTokens} out=${u.outputTokens}`
      ));

  // OpenAI 兼容多模态消息：单条 user，content 为图文数组（图在前、文在后）。
  const body = {
    model: cfg.model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: prompt },
        ],
      },
    ],
  };

  let res: Response;
  try {
    res = await fetch(cfg.chatUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new LlmVisionError(
      `视觉模型(${cfg.provider}) 请求网络错误（task=${task}）：${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!res.ok) {
    const detail = await res.text();
    throw new LlmVisionError(
      `视觉模型(${cfg.provider}) API ${res.status}（task=${task}）：${detail.slice(0, 300)}`
    );
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: unknown } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  try {
    await logUsage({
      task,
      model: cfg.model,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    });
  } catch (err) {
    console.error('[llm] OCR usage 日志写入失败：', err);
  }

  // 兼容端点的 content 通常是字符串；个别版本可能回图文数组，做兜底拼接。
  const raw = data.choices?.[0]?.message?.content;
  let text = '';
  if (typeof raw === 'string') {
    text = raw;
  } else if (Array.isArray(raw)) {
    text = raw
      .map((part) =>
        part && typeof part === 'object' && 'text' in part
          ? String((part as { text?: unknown }).text ?? '')
          : ''
      )
      .join('');
  }
  return { text: text.trim() };
}
