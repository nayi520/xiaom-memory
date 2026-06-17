/**
 * 客户端网络韧性封装（V18）—— 给浏览器端 fetch 抽一层「超时 + 退避重试 + 统一 401」。
 *
 * 背景：各组件直接用 `fetch`，超时/抖动/会话过期各写各的（或干脆不处理），表现不一致。
 * 本模块把这些横切关注点收敛到一处，**不改任何接口契约 / 请求体 / 返回结构**，只在传输层加固：
 *
 *  1) 超时：每次请求挂 AbortController，默认 {@link DEFAULT_TIMEOUT_MS} 超时即中断，避免卡白等待。
 *     调用方传了自己的 signal 时与超时信号合并（任一触发都中断）。
 *  2) 失败重试（仅幂等 GET）：网络错误 / 5xx / 408 / 429 自动重试，指数退避 + 抖动，
 *     最多 {@link DEFAULT_RETRIES} 次。**写操作（POST/PATCH/DELETE…）绝不自动重试**（避免重复副作用）。
 *  3) 统一 401：任一请求返回 401（会话过期/未登录）→ 广播一次全局事件，由
 *     {@link SessionExpiredGate} 负责提示并引导重登；**不静默卡死**。重复 401 去抖，避免刷屏。
 *
 * 设计取舍：
 *  - 纯传输层。返回的仍是原生 `Response`，调用方照旧 `res.ok / res.json()`，迁移成本极低。
 *  - 另提供 {@link apiJson}：把「发请求 + 解析 JSON + 非 2xx 抛带友好文案的 ApiError」串成一步，
 *    供新代码/重构点用；老代码可只换 `fetch`→`apiFetch` 渐进接入。
 *  - SSR / 无 fetch 环境：直接透传，不做额外动作（仅客户端组件会用到）。
 */

/** 默认请求超时（ms）。AI/导出等长任务可按需调大。 */
export const DEFAULT_TIMEOUT_MS = 15_000;
/** 长任务超时（ms）：AI 生成 / 转写 / OCR / 导出等可能数十秒，给更宽裕的上限避免误判超时。 */
export const LONG_TIMEOUT_MS = 60_000;
/** 幂等 GET 的默认自动重试次数（不含首次）。 */
export const DEFAULT_RETRIES = 2;
/** 退避基数（ms）：第 n 次重试约等待 base * 2^(n-1) + 抖动。 */
const BACKOFF_BASE_MS = 400;
/** 退避上限（ms），避免指数爆炸等待过久。 */
const BACKOFF_CAP_MS = 4_000;

/** 会话过期/未登录广播事件名（SessionExpiredGate 监听）。 */
export const SESSION_EXPIRED_EVENT = 'mxiao:session-expired';

export interface ApiFetchOptions extends RequestInit {
  /** 本次请求超时（ms），默认 {@link DEFAULT_TIMEOUT_MS}；传 0 关闭超时。 */
  timeoutMs?: number;
  /**
   * 幂等 GET 的重试次数（不含首次）。默认 {@link DEFAULT_RETRIES}。
   * 非 GET 一律忽略此项（写操作不自动重试）。传 0 关闭重试。
   */
  retries?: number;
  /**
   * 收到 401 时是否广播全局「会话过期」事件（触发重登引导）。默认 true。
   * 个别「未登录也正常、仅降级」的探测请求（如角标计数）可设 false，避免误报。
   */
  notifyOn401?: boolean;
}

/**
 * 统一错误类型：携带 HTTP 状态、是否网络层错误、是否鉴权错误，以及一句**面向用户的友好文案**。
 * 由 {@link apiJson} 抛出；UI 可直接 `err.message` 展示，或据 `status / isNetwork` 分支处理。
 */
export class ApiError extends Error {
  /** HTTP 状态码；网络/超时等传输层错误为 0。 */
  readonly status: number;
  /** 是否网络层错误（断网 / 超时 / DNS 等，非服务端返回）。 */
  readonly isNetwork: boolean;
  /** 是否鉴权失败（401）。 */
  readonly isAuth: boolean;
  /** 是否因超时中断。 */
  readonly isTimeout: boolean;

  constructor(
    message: string,
    opts: { status?: number; isNetwork?: boolean; isAuth?: boolean; isTimeout?: boolean } = {}
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = opts.status ?? 0;
    this.isNetwork = opts.isNetwork ?? false;
    this.isAuth = opts.isAuth ?? false;
    this.isTimeout = opts.isTimeout ?? false;
  }
}

/** 把任意错误转成一句友好中文文案（用于兜底 toast / 错误态）。 */
export function friendlyError(err: unknown, fallback = '出了点问题，请稍后重试'): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

let lastSessionNotifyAt = 0;
/**
 * 去抖广播「会话过期」：5s 内只播一次（避免并发 401 刷屏）。
 * 导出供少数自管传输的调用点（如 AskBox 的 SSE 流）在识别到 401 时手动触发，与 apiFetch 同口径。
 */
export function notifySessionExpired(): void {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  if (now - lastSessionNotifyAt < 5_000) return;
  lastSessionNotifyAt = now;
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
}

function isGet(method: string | undefined): boolean {
  return !method || method.toUpperCase() === 'GET';
}

/** 该状态码是否值得重试（仅对幂等 GET 生效）。 */
function isRetriableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 第 attempt 次重试（从 1 起）的退避时长：指数 + 抖动，封顶。 */
function backoffDelay(attempt: number): number {
  const exp = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));
  // ±25% 抖动，避免多端同时重试形成「重试风暴」。
  const jitter = exp * 0.25 * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(exp + jitter));
}

/**
 * 发一次请求，挂超时（与调用方 signal 合并），返回原生 Response。
 * 超时中断时抛 ApiError(isTimeout)；其余网络错误抛 ApiError(isNetwork)。
 */
async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  if (timeoutMs <= 0 || typeof AbortController === 'undefined') {
    return rawFetch(input, init);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // 合并调用方 signal：其触发也应中断本次请求。
  const external = init.signal;
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    return await rawFetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 调底层 fetch，把 abort / 网络异常归一化为 ApiError。 */
async function rawFetch(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    // AbortError：区分「超时/被取消」。调用方主动取消时由上层判断 signal，这里统一抛网络错。
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError('请求超时，请检查网络后重试', { isNetwork: true, isTimeout: true });
    }
    throw new ApiError('网络连接异常，请稍后重试', { isNetwork: true });
  }
}

/**
 * 韧性 fetch：超时 + 幂等 GET 退避重试 + 统一 401 广播。返回原生 Response。
 *
 * - 网络错误 / 可重试状态（5xx/408/429）：仅 GET 自动退避重试，达上限后把最后一次结果/错误抛出或返回。
 *   - 最后一次是「拿到响应但状态不佳」→ 返回该 Response（调用方按 res.ok 处理，行为与裸 fetch 一致）。
 *   - 最后一次是「网络层失败」→ 抛 ApiError（与裸 fetch 抛错语义一致，便于 catch）。
 * - 写操作（非 GET）：不重试；网络失败照常抛 ApiError，调用方据此回滚/入队。
 * - 任一响应 401：广播会话过期（除非 notifyOn401:false），随后照常返回该 Response（让调用方仍可读 body）。
 */
export async function apiFetch(
  input: RequestInfo | URL,
  options: ApiFetchOptions = {}
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    notifyOn401 = true,
    ...init
  } = options;

  const get = isGet(init.method);
  const maxRetries = get ? Math.max(0, retries) : 0;

  let attempt = 0;
  // 0 = 首次，1.. = 重试。
  for (;;) {
    try {
      const res = await fetchWithTimeout(input, init, timeoutMs);

      if (res.status === 401 && notifyOn401) notifySessionExpired();

      // 可重试状态且还有重试额度（仅 GET）→ 退避后重试；否则返回该响应。
      if (get && attempt < maxRetries && isRetriableStatus(res.status)) {
        attempt += 1;
        await delay(backoffDelay(attempt));
        continue;
      }
      return res;
    } catch (err) {
      // 网络层错误：GET 在额度内退避重试；否则抛出（写操作不重试）。
      if (get && attempt < maxRetries) {
        attempt += 1;
        await delay(backoffDelay(attempt));
        continue;
      }
      throw err;
    }
  }
}

/**
 * 发请求并解析 JSON；非 2xx 抛带友好文案的 {@link ApiError}（优先用后端 `{error}` 文案）。
 * 401 会触发会话过期广播（同 apiFetch），并抛 isAuth 的 ApiError，文案统一为「登录已过期…」。
 *
 * 用法：`const data = await apiJson<{ notes: Note[] }>('/api/notes?limit=3');`
 *
 * @typeParam T 期望的成功响应体类型（调用方自负其真实性，本函数不做校验）。
 */
export async function apiJson<T = unknown>(
  input: RequestInfo | URL,
  options: ApiFetchOptions = {}
): Promise<T> {
  const res = await apiFetch(input, options);

  // 尽力解析 body（即便非 2xx 也读，以取后端的 error 文案）。
  let data: unknown = null;
  const ctype = res.headers.get('content-type') ?? '';
  if (ctype.includes('application/json')) {
    data = await res.json().catch(() => null);
  } else if (!res.ok) {
    data = null;
  }

  if (res.ok) {
    return (data ?? ({} as T)) as T;
  }

  const backendMsg =
    data && typeof data === 'object' && 'error' in data
      ? String((data as { error?: unknown }).error ?? '')
      : '';

  if (res.status === 401) {
    throw new ApiError(backendMsg || '登录已过期，请重新登录', {
      status: 401,
      isAuth: true,
    });
  }
  if (res.status >= 500) {
    throw new ApiError(backendMsg || '服务暂时不可用，请稍后重试', { status: res.status });
  }
  throw new ApiError(backendMsg || `请求失败（${res.status}）`, { status: res.status });
}
