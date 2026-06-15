/**
 * 搜索结果列表（F4.2 + V8 混合检索筛选）：每条标注命中来源（关键词 / 标签 / 语义）。
 * 顶部提供筛选 chips：检索模式（混合 / 关键词 / 语义）+ 领域（多选其一）。
 * 服务端组件，由 /library 页在搜索模式下渲染；chips 为 <Link>，保留 q 切换 domain/mode。
 */

import Link from 'next/link';
import {
  HIT_SOURCE_LABELS,
  type HitSource,
  type SearchHit,
  type SearchMode,
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

const MODES: SearchMode[] = ['hybrid', 'keyword', 'semantic'];

interface Props {
  q: string;
  hits: SearchHit[];
  semanticUsed: boolean;
  domain: string | null;
  mode: SearchMode;
  domainOptions: string[];
  modeLabels: Record<SearchMode, string>;
}

/** 构造保留 q 的搜索 URL（可覆盖 domain / mode；空值省略，mode=hybrid 省略以保持简洁）。 */
function searchHref(q: string, domain: string | null, mode: SearchMode): string {
  const p = new URLSearchParams();
  p.set('q', q);
  if (domain) p.set('domain', domain);
  if (mode !== 'hybrid') p.set('mode', mode);
  return `/library?${p.toString()}`;
}

export default function SearchResults({
  q,
  hits,
  semanticUsed,
  domain,
  mode,
  domainOptions,
  modeLabels,
}: Props) {
  const chipBase =
    'rounded-pill px-2.5 py-1 text-xs font-medium transition focus-visible:outline-none';
  const chipOn = 'bg-brand text-white shadow-sm';
  const chipOff =
    'border border-zinc-200 bg-white text-zinc-600 hover:border-brand hover:text-brand dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300';

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

      {/* 筛选 chips：检索模式 + 领域 */}
      <div className="mb-3 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-xs text-zinc-400">模式</span>
          {MODES.map((m) => (
            <Link
              key={m}
              href={searchHref(q, domain, m)}
              aria-pressed={mode === m}
              className={cn(chipBase, mode === m ? chipOn : chipOff)}
            >
              {modeLabels[m]}
            </Link>
          ))}
        </div>
        {domainOptions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-xs text-zinc-400">领域</span>
            <Link
              href={searchHref(q, null, mode)}
              aria-pressed={!domain}
              className={cn(chipBase, !domain ? chipOn : chipOff)}
            >
              全部
            </Link>
            {domainOptions.map((d) => (
              <Link
                key={d}
                href={searchHref(q, d, mode)}
                aria-pressed={domain === d}
                className={cn(chipBase, domain === d ? chipOn : chipOff, 'max-w-[12rem] truncate')}
              >
                {d}
              </Link>
            ))}
          </div>
        )}
      </div>

      {!semanticUsed && mode !== 'keyword' && (
        <p className="mb-3 rounded-field bg-zinc-100 px-3.5 py-2.5 text-xs leading-relaxed text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          语义搜索未启用（需配置 DASHSCOPE_API_KEY），当前仅关键词与标签匹配。
        </p>
      )}

      {hits.length === 0 ? (
        <EmptyState
          icon={<SearchIcon aria-hidden className="h-7 w-7" />}
          title="没找到相关内容"
          description={domain ? '该领域下没有匹配，试试切到「全部」领域或换个关键词。' : '换个关键词，或检查有没有错别字。'}
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
