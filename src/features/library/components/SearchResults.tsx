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
import {
  EmptyState,
  SearchIcon,
  CloseIcon,
  WhyIcon,
  NoteIcon,
  cardClass,
  cn,
} from '@/components/ui';

const SOURCE_STYLES: Record<HitSource, string> = {
  keyword: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
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
          “<span className="font-medium text-zinc-600 dark:text-zinc-300">{q}</span>” 共{' '}
          {hits.length} 条结果
        </p>
        <Link
          href="/library"
          className="inline-flex items-center gap-1 rounded-md transition hover:text-zinc-600 focus-visible:outline-none dark:hover:text-zinc-300"
        >
          清除
          <CloseIcon aria-hidden className="h-3.5 w-3.5" />
        </Link>
      </div>

      {!semanticUsed && (
        <p className="mb-3 rounded-field bg-zinc-100 px-3.5 py-2.5 text-xs leading-relaxed text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          语义搜索未启用（需配置 OPENAI_API_KEY），当前仅关键词与标签匹配。
        </p>
      )}

      {hits.length === 0 ? (
        <EmptyState
          icon={<SearchIcon aria-hidden className="h-7 w-7" />}
          title="没找到相关内容"
          description="换个关键词，或检查有没有错别字。"
        />
      ) : (
        <ul className="space-y-2.5">
          {hits.map((hit) => (
            <li key={`${hit.kind}:${hit.id}`}>
              <Link
                href={
                  hit.kind === 'concept'
                    ? `/library/concept/${hit.id}`
                    : `/library/note/${hit.id}`
                }
                className={cn(cardClass({ interactive: true, padded: false }), 'block px-4 py-3.5')}
              >
                <div className="flex items-center gap-2">
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-zinc-400">
                    {hit.kind === 'concept' ? (
                      <WhyIcon aria-hidden className="h-3.5 w-3.5 text-amber-400" />
                    ) : (
                      <NoteIcon aria-hidden className="h-3.5 w-3.5" />
                    )}
                    {hit.kind === 'concept' ? '概念' : '记录'}
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {hit.sources.map((s) => (
                      <span
                        key={s}
                        className={cn(
                          'rounded-pill px-1.5 py-0.5 text-[10px] font-medium leading-none',
                          SOURCE_STYLES[s]
                        )}
                      >
                        {HIT_SOURCE_LABELS[s]}
                        {s === 'semantic' && hit.similarity !== undefined
                          ? ` ${Math.round(hit.similarity * 100)}%`
                          : ''}
                      </span>
                    ))}
                  </span>
                </div>
                <p className="mt-1.5 break-words font-semibold leading-snug text-zinc-800 dark:text-zinc-100">
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
