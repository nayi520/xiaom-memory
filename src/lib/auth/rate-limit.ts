/**
 * 极简内存级限频 —— 注册 / 验证重发等公开端点防滥用
 *
 * 单实例自用足够；多实例 / 严格限频后续可换 Redis。进程重启即清零。
 * 按「桶名 + key（通常 IP 或 email）」滑动窗口计数。
 */

interface Bucket {
  count: number;
  resetAt: number;
}

// 桶名 → (key → 计数)。模块级单例，跨请求保留。
const store = new Map<string, Map<string, Bucket>>();

/**
 * 记一次访问并判断是否超限。
 * @param bucket  逻辑分区名（如 'register' / 'resend'）。
 * @param key     限频主体（IP / email）。
 * @param max     窗口内最大次数。
 * @param windowMs 窗口长度（毫秒）。
 * @returns true=已超限（应拒绝）；false=放行。
 */
export function hitRateLimit(
  bucket: string,
  key: string,
  max: number,
  windowMs: number
): boolean {
  const now = Date.now();
  let m = store.get(bucket);
  if (!m) {
    m = new Map();
    store.set(bucket, m);
  }
  const rec = m.get(key);
  if (!rec || now > rec.resetAt) {
    m.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  rec.count += 1;
  return rec.count > max;
}

/** 从请求头取客户端 IP（x-forwarded-for 优先，回落 x-real-ip）。 */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}
