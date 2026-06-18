/**
 * 命中词高亮（V22）—— 把文本按查询词包 <mark>，用于搜索结果标题/摘要。
 *
 * 纯渲染、无状态、无 hooks：服务端组件（SearchResults）与客户端组件（CommandPalette）皆可用。
 * 切词逻辑复用 search.ts 的 splitByTerms（纯函数，已被 test:search 覆盖）。
 * <mark> 用品牌色淡底 + 不改字重，深浅色均保证 AA 对比。
 */

import { splitByTerms } from '../highlight';

export default function Highlight({ text, query }: { text: string; query: string }) {
  if (!text) return null;
  const segments = splitByTerms(text, query);
  // 无命中（或无词）：直接渲染原文，避免无谓的 <span> 包裹。
  if (segments.length === 1 && !segments[0].match) return <>{text}</>;
  return (
    <>
      {segments.map((seg, i) =>
        seg.match ? (
          // 仅加品牌色淡底 + 保留外层文字色（text-inherit），确保高亮处对比度照旧达 AA。
          // 字重略加强，弱视/灰度下也能分辨命中片段。
          <mark
            key={i}
            className="rounded-[3px] bg-brand/20 px-0.5 font-semibold text-inherit dark:bg-brand/30"
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </>
  );
}
