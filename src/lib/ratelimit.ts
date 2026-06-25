/**
 * 通用限流（成本/滥用闸）—— 滑动窗口计数，内存实现但接口可换 Redis
 *
 * 与 lib/auth/rate-limit.ts 的区别与分工：
 *   - auth/rate-limit：注册/验证重发等**公开**端点防滥用（按 IP/email，hitRateLimit 返回 bool）。
 *     那是已提交的「注册门禁」领域，本文件**不动它**。
 *   - 本文件：**业务 AI 端点**（ask/transcribe/clip/audio）的限流，按 `userId + 端点` 限频，
 *     返回结构化结果（含 retryAfter），供路由直接拼 429 响应。
 *
 * 接口设计为**可换 Redis**：导出 `checkRateLimit(key, { limit, windowMs })` 同步签名，
 *   将来换分布式实现时改内部存储即可，调用方零改动；key 由调用方拼 `userId:端点`。
 * 当前为单实例内存版（进程重启即清零，自用足够；多实例/严格限频后续换 Redis）。
 *
 * 算法：固定窗口计数（窗口长度 windowMs）。窗口内累计 ≤ limit 放行；超出拒绝并给出
 *   到窗口重置的剩余秒数（retryAfter）。相比令牌桶更简单、对自用够用，且无后台计时器。
 */

export interface RateLimitOptions {
  /** 窗口内允许的最大次数。 */
  limit: number;
  /** 窗口长度（毫秒）。 */
  windowMs: number;
}

export interface RateLimitResult {
  /** 是否放行（true=未超限）。 */
  ok: boolean;
  /** 本窗口剩余可用次数（已扣本次；放行时 ≥ 0，拒绝时为 0）。 */
  remaining: number;
  /** 距本窗口重置的秒数（向上取整，≥ 1）；超限时供 429 的 retryAfter / Retry-After。 */
  retryAfter: number;
  /** 本窗口重置的 epoch 毫秒（便于将来设 X-RateLimit-Reset 头）。 */
  resetAt: number;
}

interface Window {
  count: number;
  resetAt: number;
}

/**
 * 存储抽象：将来换 Redis 时实现同形态接口即可（get/set 原子性由具体实现保证）。
 * 内存版用 Map；key 为调用方拼好的「userId:端点」之类的唯一串。
 */
const store = new Map<string, Window>();

/**
 * 记一次访问并判断是否超限（固定窗口计数）。
 *
 * @param key  限频主体（调用方拼 `userId:端点`，如 `<uuid>:ask`）。
 * @param opts { limit, windowMs }
 * @returns RateLimitResult；ok=false 时按 retryAfter 提示客户端稍后再试。
 */
export function checkRateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const { limit, windowMs } = opts;
  const now = Date.now();
  const cur = store.get(key);

  // 窗口不存在或已过期 → 开新窗口，本次计 1。
  if (!cur || now >= cur.resetAt) {
    const resetAt = now + windowMs;
    store.set(key, { count: 1, resetAt });
    return {
      ok: true,
      remaining: Math.max(0, limit - 1),
      retryAfter: Math.ceil(windowMs / 1000),
      resetAt,
    };
  }

  // 窗口内：自增并判超额。
  cur.count += 1;
  const remaining = Math.max(0, limit - cur.count);
  const retryAfter = Math.max(1, Math.ceil((cur.resetAt - now) / 1000));
  return {
    ok: cur.count <= limit,
    remaining,
    retryAfter,
    resetAt: cur.resetAt,
  };
}

/** 测试/维护用：清空内存窗口（生产无需调用）。 */
export function __resetRateLimitStore(): void {
  store.clear();
}

// ============ 业务 AI 端点的限流档位（按 userId + 端点） ============
// 这些是「突发滥用」闸（短窗口高频），与「每日总量」配额（lib/quota）互补：
//   限流挡住短时间狂刷（如脚本每秒打几十次）；配额挡住一整天累计刷爆成本。
// 默认值偏宽松（够正常人手动操作），可由 env 覆盖窗口内上限（窗口长度固定 1 分钟）。
// image=图片上传(/api/images)；ocr=图片转文字(/api/ocr，qwen-vl)。V13 新增。
// gen=AI 生成(/api/generate-cards、/api/study-guide)，单次较重，按分钟限频。V16 新增。
// export=整库导出(/api/export?format=json|md)，全量取数较重，给低频闸防被刷。V29 新增。
export type AiEndpoint =
  | 'ask'
  | 'transcribe'
  | 'clip'
  | 'audio'
  | 'image'
  | 'ocr'
  | 'gen'
  | 'export';

const RATE_WINDOW_MS = 60_000; // 1 分钟固定窗口

const RATE_CONFIG: Record<AiEndpoint, { env: string; fallback: number }> = {
  ask: { env: 'RATE_ASK_PER_MIN', fallback: 20 },
  transcribe: { env: 'RATE_TRANSCRIBE_PER_MIN', fallback: 10 },
  clip: { env: 'RATE_CLIP_PER_MIN', fallback: 20 },
  audio: { env: 'RATE_AUDIO_PER_MIN', fallback: 20 },
  image: { env: 'RATE_IMAGE_PER_MIN', fallback: 20 },
  ocr: { env: 'RATE_OCR_PER_MIN', fallback: 10 },
  gen: { env: 'RATE_GEN_PER_MIN', fallback: 10 },
  // 整库导出：全量取数+拼接较重，正常人不会一分钟点很多次，给保守低频闸。
  export: { env: 'RATE_EXPORT_PER_MIN', fallback: 6 },
};

/** 解析某端点每分钟上限：env 有合法正整数则用之，否则用缺省。 */
function perMinuteLimit(endpoint: AiEndpoint): number {
  const { env, fallback } = RATE_CONFIG[endpoint];
  const raw = process.env[env];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.trunc(n);
}

/**
 * 业务 AI 端点限流的便捷封装：按 `userId:端点` 固定窗口（1 分钟）限频。
 * 路由在 handler 内调用（**不改 middleware**），超限按返回的 retryAfter 回 429。
 *
 * @param userId   当前登录用户 id（从 getCurrentUser 取得）。
 * @param endpoint 端点名（ask/transcribe/clip/audio）。
 */
export function enforceAiRateLimit(userId: string, endpoint: AiEndpoint): RateLimitResult {
  return checkRateLimit(`${userId}:${endpoint}`, {
    limit: perMinuteLimit(endpoint),
    windowMs: RATE_WINDOW_MS,
  });
}
