/**
 * 搜索结果列表（F4.2）：每条标注命中来源（关键词 / 标签 / 语义）。
 * 服务端组件，由 /library 页在搜索模式下渲染。
 */

import Link from 'next/link';
import {
  HIT_SOURCE_LABELS,
  type HitSource,
  type SearchHit,
} from '../search';

const SOURCE_STYLES: Record<HitSource, string> = {
  keyword:
    'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
  tag: 'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400',
  semantic: 'bg-sky-50 text-sky-600 dark:bg-sky-950 dark:text-sky-400',
};

interface Props {
  q: string;
  hits: SearchHit[];
  semanticUsed: boolean;
}

export default function SearchResults({ q, hits, semanticUsed }: Props) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between text-sm text-zinc-400">
        <p>
          “{q}” 共 {hits.length} 条结果
        </p>
        <Link href="/library" className="transition active:text-zinc-600">
          清除 ✕
        </Link>
      </div>

      {!semanticUsed && (
        <p className="mb-3 rounded-xl bg-zinc-100 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          语义搜索未启用（需配置 OPENAI_API_KEY），当前仅关键词与标签匹配。
        </p>
      )}

      {hits.length === 0 ? (
        <p className="mt-10 text-center text-sm text-zinc-400">
          没找到相关内容，换个关键词试试。
        </p>
      ) : (
        <ul className="space-y-2">
          {hits.map((hit) => (
            <li key={`${hit.kind}:${hit.id}`}>
              <Link
                href={
                  hit.kind === 'concept'
                    ? `/library/concept/${hit.id}`
                    : `/library/note/${hit.id}`
                }
                className="block rounded-2xl border border-zinc-200 bg-white px-4 py-3.5 transition active:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:active:bg-zinc-800"
              >
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-xs text-zinc-400">
                    {hit.kind === 'concept' ? '💡 概念' : '📝 记录'}
                  </span>
                  <span className="flex gap-1">
                    {hit.sources.map((s) => (
                      <span
                        key={s}
                        className={`rounded-full px-1.5 py-0.5 text-[10px] leading-none ${SOURCE_STYLES[s]}`}
                      >
                        {HIT_SOURCE_LABELS[s]}
                        {s === 'semantic' && hit.similarity !== undefined
                          ? ` ${Math.round(hit.similarity * 100)}%`
                          : ''}
                      </span>
                    ))}
                  </span>
                </div>
                <p className="mt-1.5 break-words font-medium leading-snug">
                  {hit.title}
                </p>
                {hit.snippet && (
                  <p className="mt-1 break-words text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                    {hit.snippet}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
