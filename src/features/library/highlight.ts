/**
 * 命中词高亮 / 查询分词（V22）—— 纯函数、零依赖。
 *
 * 单独成模块（不引 drizzle / db / embeddings），以便客户端组件（CommandPalette）安全引用，
 * 不把服务端数据访问代码拖进浏览器包。search.ts 仍从这里 re-export，旧引用与测试零改动。
 */

/**
 * 把查询串切成用于高亮的「词」：按空白分词、去空、去重、按长度降序
 * （长词优先匹配，避免短词先吞掉长词的一部分）。中文无空格时整串作一个词。
 */
export function tokenizeQuery(q: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const raw of q.trim().split(/\s+/)) {
    const t = raw.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    tokens.push(t);
  }
  return tokens.sort((a, b) => b.length - a.length);
}

/** 正则元字符转义（把用户查询词安全地塞进 RegExp）。 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 文本片段：match 标记是否为命中词（供 UI 决定是否包 <mark>）。 */
export interface HighlightSegment {
  text: string;
  match: boolean;
}

/**
 * 把文本按查询词切成片段（命中词大小写不敏感），供前端渲染高亮。
 * 纯函数、零依赖（不产生 JSX），便于单测。无词 / 无命中时返回整段单片段。
 */
export function splitByTerms(text: string, query: string): HighlightSegment[] {
  if (!text) return [];
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return [{ text, match: false }];
  // 全局正则 + exec 循环（避免 matchAll 迭代器对 TS 下层迭代目标的依赖）。
  const re = new RegExp(`(${tokens.map(escapeRegExp).join('|')})`, 'giu');
  const segments: HighlightSegment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    if (start > last) segments.push({ text: text.slice(last, start), match: false });
    segments.push({ text: m[0], match: true });
    last = start + m[0].length;
    // 防御零宽匹配死循环（理论上 token 非空不会触发，仍兜底）。
    if (m[0].length === 0) re.lastIndex += 1;
  }
  if (last < text.length) segments.push({ text: text.slice(last), match: false });
  return segments.length > 0 ? segments : [{ text, match: false }];
}
