/**
 * 录音文件转写封装（去 Supabase 改造：百炼 Fun-ASR · 录音文件异步识别）
 *
 * 形态与现有 Whisper 转写（src/app/api/transcribe/route.ts）的差异：
 * - Whisper 是「上传二进制 → 同步拿文本」；Fun-ASR 是「提交公网音频 URL → 异步任务 → 轮询取结果」。
 * - 因此本模块**只收公网可访问的音频 URL**（调用方负责先把音频落 OSS 并拿到签名 URL）。
 * - 单文件时长上限 12h；支持 wav/mp3/m4a/aac/opus/amr 等常见格式（DashScope 侧解析）。
 *
 * 接口形态（DashScope 原生异步 API，非 OpenAI 兼容端点）：
 *   1) 提交：POST {DASHSCOPE_BASE}/api/v1/services/audio/asr/transcription
 *            头 `X-DashScope-Async: enable`，body { model, input.file_urls, parameters }
 *            → 返回 output.task_id + output.task_status=PENDING
 *   2) 轮询：GET  {DASHSCOPE_BASE}/api/v1/tasks/{task_id}
 *            → task_status ∈ PENDING/RUNNING/SUCCEEDED/FAILED；
 *            SUCCEEDED 时 output.results[] 各含一个 transcription_url（指向结果 JSON 文件，**不是内联文本**）
 *   3) 取文本：GET transcription_url → JSON.transcripts[].text 即整段转写文本
 *
 * 设计约定（对齐 llm.ts / embeddings.ts）：
 * - 读 env DASHSCOPE_API_KEY；缺 key 抛 AsrKeyMissingError，由调用入口优雅降级（与 transcribe 的「待配置」一致）。
 * - 仅用 fetch，不引 SDK。base_url 经 DASHSCOPE_BASE_URL 可覆盖（与 llm/embeddings 共用习惯，
 *   但本模块走的是 .../api/v1 原生路径，而非 .../compatible-mode/v1，故单独取根域）。
 * - 合理的轮询间隔（默认 3s）与总超时（默认 5min）；失败/超时抛清晰错误。
 */

// ============ 常量（可经环境变量覆盖） ============

/** Fun-ASR 模型名（可覆盖，如 fun-asr / paraformer-v2 等录音文件识别模型） */
export const FUNASR_MODEL = process.env.MEMORY_FUNASR_MODEL ?? 'fun-asr';

/**
 * DashScope 服务根域。
 * 注意：llm/embeddings 用的是 OpenAI 兼容端点 `.../compatible-mode/v1`，
 * 而录音文件异步识别走原生 `.../api/v1` 路径，二者根域相同、子路径不同。
 * 优先读 MEMORY_DASHSCOPE_HTTP_BASE；否则从 DASHSCOPE_BASE_URL 推导根域；再否则用官方默认。
 */
function resolveHttpBase(): string {
  const explicit = process.env.MEMORY_DASHSCOPE_HTTP_BASE;
  if (explicit) return explicit.replace(/\/$/, '');

  const compat = process.env.DASHSCOPE_BASE_URL;
  if (compat) {
    // 把 https://dashscope.aliyuncs.com/compatible-mode/v1 → https://dashscope.aliyuncs.com
    try {
      return new URL(compat).origin;
    } catch {
      /* 落到默认 */
    }
  }
  return 'https://dashscope.aliyuncs.com';
}

const HTTP_BASE = resolveHttpBase();
const SUBMIT_URL = `${HTTP_BASE}/api/v1/services/audio/asr/transcription`;
const TASK_URL = (taskId: string) => `${HTTP_BASE}/api/v1/tasks/${taskId}`;

/** 轮询间隔（毫秒），默认 3s */
const POLL_INTERVAL_MS = Number(process.env.MEMORY_FUNASR_POLL_INTERVAL_MS ?? 3000);
/** 总超时（毫秒），默认 5min */
const POLL_TIMEOUT_MS = Number(process.env.MEMORY_FUNASR_TIMEOUT_MS ?? 5 * 60 * 1000);

// ============ 错误类型 ============

export class AsrKeyMissingError extends Error {
  constructor() {
    super('未配置 DASHSCOPE_API_KEY，无法调用 Fun-ASR 转写');
    this.name = 'AsrKeyMissingError';
  }
}

/** 提交 / 轮询 / 取结果阶段的 HTTP 或业务失败 */
export class AsrTranscribeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AsrTranscribeError';
  }
}

/** 轮询超过总超时仍未结束 */
export class AsrTimeoutError extends Error {
  readonly taskId: string;
  constructor(taskId: string, timeoutMs: number) {
    super(`Fun-ASR 转写超时（task_id=${taskId}，已等待 ${Math.round(timeoutMs / 1000)}s）`);
    this.name = 'AsrTimeoutError';
    this.taskId = taskId;
  }
}

// ============ DashScope 响应类型（仅取用到的字段） ============

type TaskStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | string;

interface DashScopeTaskEnvelope {
  request_id?: string;
  output?: {
    task_id?: string;
    task_status?: TaskStatus;
    /** 失败时的错误信息 */
    code?: string;
    message?: string;
    /** SUCCEEDED 时每个输入 URL 对应一条结果 */
    results?: Array<{
      file_url?: string;
      /** 单条结果的状态（部分成功时有用） */
      subtask_status?: TaskStatus;
      /** 指向结果 JSON 文件的公网 URL（真正的文本在该文件里） */
      transcription_url?: string;
      code?: string;
      message?: string;
    }>;
  };
  code?: string;
  message?: string;
}

/** transcription_url 指向的结果文件结构（仅取用到的字段） */
interface TranscriptionResultFile {
  transcripts?: Array<{
    /** 整段（或该声道）转写文本 */
    text?: string;
    channel_id?: number;
    sentences?: Array<{ text?: string; begin_time?: number; end_time?: number }>;
  }>;
}

// ============ 工具 ============

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
  };
}

// ============ 主流程 ============

export interface TranscribeOpts {
  /**
   * 语言提示（可选）。Fun-ASR 默认自动识别中英；如需限定可传，
   * 形如 'zh' / 'en'，内部映射到 parameters.language_hints=[...]。
   */
  language?: string;
  /** 覆盖默认轮询间隔（毫秒） */
  pollIntervalMs?: number;
  /** 覆盖默认总超时（毫秒） */
  timeoutMs?: number;
}

/**
 * 把一个公网音频 URL 交给 Fun-ASR 转写，返回整段文本。
 *
 * @param audioUrl 公网可访问的音频 URL（调用方先落 OSS 并拿到签名 URL）
 * @param opts     语言提示 / 轮询参数（可选）
 * @returns        { text } 完整转写文本（多声道/多段会按顺序拼接）
 * @throws AsrKeyMissingError  未配置 DASHSCOPE_API_KEY（调用入口应据此优雅降级）
 * @throws AsrTranscribeError  提交 / 轮询 / 取结果失败，或任务 FAILED
 * @throws AsrTimeoutError     轮询超过总超时仍未完成
 */
export async function transcribeAudioUrl(
  audioUrl: string,
  opts: TranscribeOpts = {}
): Promise<{ text: string }> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new AsrKeyMissingError();

  if (!audioUrl || !/^https?:\/\//i.test(audioUrl)) {
    throw new AsrTranscribeError(
      `Fun-ASR 需要公网可访问的音频 URL（http/https），收到：${String(audioUrl).slice(0, 120)}`
    );
  }

  const taskId = await submitTask(apiKey, audioUrl, opts);
  const transcriptionUrl = await pollUntilDone(apiKey, taskId, opts);
  const text = await fetchTranscriptText(transcriptionUrl);
  return { text };
}

// ============ 异步分步接口（会议记录 / 长音频：提交即返回，状态另查） ============
//
// transcribeAudioUrl 是「提交+轮询+取文本」的同步封装，受 serverless 时长所限只适合短音频。
// 会议/长音频改用下面三段式：submitTranscription（存 task_id 即返回）→ checkTranscription（查一次）
// → fetchTranscriptText（done 时取整段文本）。轮询/兜底由调用方（status 路由 + cron）负责。

/** checkTranscription 的归一化返回：pending=仍在跑；done=可取文本；failed=失败。 */
export interface TranscriptionStatus {
  status: 'pending' | 'done' | 'failed';
  /** done 时指向结果 JSON 文件的公网 URL（交给 fetchTranscriptText 取文本）。 */
  transcriptionUrl?: string;
  /** failed / 异常时的人类可读说明。 */
  message?: string;
}

/**
 * 提交一个异步转写任务，立即返回 task_id（不等待结果）。
 * @throws AsrKeyMissingError 未配置 DASHSCOPE_API_KEY（调用入口据此优雅降级）
 * @throws AsrTranscribeError URL 非法 / 提交失败
 */
export async function submitTranscription(
  audioUrl: string,
  opts: TranscribeOpts = {}
): Promise<string> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new AsrKeyMissingError();
  if (!audioUrl || !/^https?:\/\//i.test(audioUrl)) {
    throw new AsrTranscribeError(
      `Fun-ASR 需要公网可访问的音频 URL（http/https），收到：${String(audioUrl).slice(0, 120)}`
    );
  }
  return submitTask(apiKey, audioUrl, opts);
}

/**
 * 查询一次任务状态（单次，不循环）。归一化为 pending/done/failed：
 * PENDING/RUNNING → pending；SUCCEEDED → done(+transcriptionUrl)；FAILED/CANCELED → failed。
 * 网络抖动 / 5xx → 视为 pending（交调用方下次再查），不误判失败。
 * @throws AsrKeyMissingError 未配置 DASHSCOPE_API_KEY
 */
export async function checkTranscription(taskId: string): Promise<TranscriptionStatus> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new AsrKeyMissingError();

  let res: Response;
  try {
    res = await fetch(TASK_URL(taskId), { method: 'GET', headers: authHeaders(apiKey) });
  } catch (err) {
    return {
      status: 'pending',
      message: `查询网络错误：${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!res.ok) {
    const detail = await res.text();
    if (res.status >= 500) return { status: 'pending', message: `查询 HTTP ${res.status}` };
    return { status: 'failed', message: `查询失败 HTTP ${res.status}：${detail.slice(0, 200)}` };
  }

  const data = (await res.json()) as DashScopeTaskEnvelope;
  const st = data.output?.task_status;
  if (st === 'SUCCEEDED') {
    try {
      return { status: 'done', transcriptionUrl: extractTranscriptionUrl(data, taskId) };
    } catch (err) {
      return { status: 'failed', message: err instanceof Error ? err.message : String(err) };
    }
  }
  if (st === 'FAILED' || st === 'CANCELED') {
    const reason = data.output?.message ?? data.output?.code ?? data.message ?? '未知原因';
    return {
      status: 'failed',
      message: `任务${st === 'CANCELED' ? '被取消' : '失败'}：${reason}`,
    };
  }
  return { status: 'pending' };
}

/** 1) 提交异步任务，返回 task_id */
async function submitTask(
  apiKey: string,
  audioUrl: string,
  opts: TranscribeOpts
): Promise<string> {
  const parameters: Record<string, unknown> = {};
  if (opts.language) parameters.language_hints = [opts.language];

  const body = {
    model: FUNASR_MODEL,
    input: { file_urls: [audioUrl] },
    parameters,
  };

  let res: Response;
  try {
    res = await fetch(SUBMIT_URL, {
      method: 'POST',
      headers: {
        ...authHeaders(apiKey),
        // 关键：声明异步，DashScope 立即返回 task_id 而非等待结果
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new AsrTranscribeError(
      `Fun-ASR 提交任务网络错误：${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!res.ok) {
    const detail = await res.text();
    throw new AsrTranscribeError(
      `Fun-ASR 提交任务失败 HTTP ${res.status}：${detail.slice(0, 300)}`
    );
  }

  const data = (await res.json()) as DashScopeTaskEnvelope;
  const taskId = data.output?.task_id;
  if (!taskId) {
    const reason = data.message ?? data.output?.message ?? JSON.stringify(data).slice(0, 300);
    throw new AsrTranscribeError(`Fun-ASR 提交任务未返回 task_id：${reason}`);
  }
  return taskId;
}

/** 2) 轮询任务直到 SUCCEEDED/FAILED 或超时，成功时返回首条结果的 transcription_url */
async function pollUntilDone(
  apiKey: string,
  taskId: string,
  opts: TranscribeOpts
): Promise<string> {
  const intervalMs = opts.pollIntervalMs ?? POLL_INTERVAL_MS;
  const timeoutMs = opts.timeoutMs ?? POLL_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  // 提交后任务通常处于 PENDING，先等一个间隔再查，减少无谓请求
  while (Date.now() < deadline) {
    await sleep(intervalMs);

    let res: Response;
    try {
      res = await fetch(TASK_URL(taskId), {
        method: 'GET',
        headers: authHeaders(apiKey),
      });
    } catch (err) {
      // 单次网络抖动不致命，继续轮询直到超时
      console.warn(
        `[funasr] 轮询网络错误（task_id=${taskId}），将重试：`,
        err instanceof Error ? err.message : String(err)
      );
      continue;
    }

    if (!res.ok) {
      // 5xx 视为暂时性，继续轮询；4xx 多为不可恢复，直接抛
      const detail = await res.text();
      if (res.status >= 500) {
        console.warn(`[funasr] 轮询 HTTP ${res.status}（task_id=${taskId}），将重试`);
        continue;
      }
      throw new AsrTranscribeError(
        `Fun-ASR 轮询失败 HTTP ${res.status}（task_id=${taskId}）：${detail.slice(0, 300)}`
      );
    }

    const data = (await res.json()) as DashScopeTaskEnvelope;
    const status = data.output?.task_status;

    if (status === 'SUCCEEDED') {
      return extractTranscriptionUrl(data, taskId);
    }
    if (status === 'FAILED' || status === 'CANCELED') {
      const reason =
        data.output?.message ?? data.output?.code ?? data.message ?? '未知原因';
      throw new AsrTranscribeError(
        `Fun-ASR 任务${status === 'CANCELED' ? '被取消' : '失败'}（task_id=${taskId}）：${reason}`
      );
    }
    // PENDING / RUNNING → 继续等
  }

  throw new AsrTimeoutError(taskId, timeoutMs);
}

/** 从 SUCCEEDED 信封里取出首条可用结果的 transcription_url */
function extractTranscriptionUrl(data: DashScopeTaskEnvelope, taskId: string): string {
  const results = data.output?.results ?? [];
  // 单输入 → 取第一条；优先挑成功且带 url 的
  const ok = results.find((r) => r.transcription_url);
  if (!ok?.transcription_url) {
    // 整任务 SUCCEEDED 但子结果失败（如该文件解码失败）
    const failed = results.find((r) => r.code || r.message);
    const reason = failed
      ? `${failed.code ?? ''} ${failed.message ?? ''}`.trim()
      : '结果中无 transcription_url';
    throw new AsrTranscribeError(
      `Fun-ASR 任务完成但无可用转写结果（task_id=${taskId}）：${reason}`
    );
  }
  return ok.transcription_url;
}

/** 3) 拉取 transcription_url 指向的结果文件并拼出整段文本 */
export async function fetchTranscriptText(transcriptionUrl: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(transcriptionUrl, { method: 'GET' });
  } catch (err) {
    throw new AsrTranscribeError(
      `Fun-ASR 拉取转写结果网络错误：${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!res.ok) {
    const detail = await res.text();
    throw new AsrTranscribeError(
      `Fun-ASR 拉取转写结果失败 HTTP ${res.status}：${detail.slice(0, 200)}`
    );
  }

  const file = (await res.json()) as TranscriptionResultFile;
  const transcripts = file.transcripts ?? [];
  // 每个 transcript 是一个声道/整段；优先用其 text，缺则由 sentences 兜底拼接
  const parts = transcripts.map((t) => {
    if (t.text && t.text.trim()) return t.text.trim();
    const fromSentences = (t.sentences ?? [])
      .map((s) => s.text?.trim() ?? '')
      .filter(Boolean)
      .join('');
    return fromSentences;
  });

  const text = parts.filter(Boolean).join('\n').trim();
  // 空文本（如纯静音）不视为错误，返回空串，交由调用方决定如何呈现
  return text;
}
