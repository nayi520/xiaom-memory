/**
 * 最近搜索（V22）—— localStorage 持久化，跨刷新/切页保留，可清除。
 *
 * 纯客户端工具：知识库搜索框与无结果态共用。隐私模式/配额写失败时整体降级为不记录，
 * 不抛错、不阻断搜索。仅存查询词字符串（不含任何账号/内容敏感信息）。
 */

const KEY = 'mxiao.recent-searches';
const MAX = 8;

/** 读最近搜索（最新在前）；读不到 / 解析失败 → 空数组。 */
export function readRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).slice(0, MAX);
  } catch {
    return [];
  }
}

/**
 * 记一次搜索（去重置顶、截断到 MAX）。返回更新后的列表（便于即时回填 UI）。
 * 空查询忽略。写失败静默降级。
 */
export function pushRecentSearch(q: string): string[] {
  const query = q.trim();
  if (!query) return readRecentSearches();
  const next = [query, ...readRecentSearches().filter((x) => x !== query)].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 隐私模式/配额：降级为内存态，不抛错 */
  }
  return next;
}

/** 清空最近搜索。 */
export function clearRecentSearches(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
