/**
 * 搜索结果列表（F4.2 + V8 混合检索筛选 + V22 高亮/类型筛选/无结果优化）：
 * 每条标注命中来源（关键词 / 标签 / 语义），命中词在标题/摘要里高亮。
 * 顶部筛选 chips：类型（全部 / 概念 / 记录）+ 检索模式（混合 / 关键词 / 语义）+ 领域 + 标签。
 * 服务端组件，由 /library 页在搜索模式下渲染；chips 为 <Link>，保留 q 切换各筛选维度。
 * 无结果态给出建议 + 最近搜索（SearchNoResults 客户端补充）。
 */

import Link from 'next/link';
import {
  HIT_SOURCE_LABELS,
  type HitSource,
  type SearchHit,
  type SearchMode,
} from '../search';
import Highlight from './Highlight';
import SearchNoResults from './SearchNoResults';
import {
  EmptySearch,
  CloseIcon,
  WhyIcon,
  NoteIcon,
  MeetingBadge,
  cardClass,
  cn,
} from '@/components/ui';

const SOURCE_STYLES: Record<HitSource, string> = {
  keyword: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
  tag: 'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400',
  semantic: 'bg-sky-50 text-sky-600 dark:bg-sky-950 dark:text-sky-400',
};

const MODES: SearchMode[] = ['hybrid', 'keyword', 'semantic'];

/** 结果类型筛选维度（前端按 kind / isMeeting 过滤，不动后端检索）。meeting = 长语音会议记录。 */
export type TypeFilter = 'all' | 'concept' | 'note' | 'meeting';
const TYPES: { key: TypeFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'concept', label: '概念' },
  { key: 'note', label: '记录' },
  { key: 'meeting', label: '会议' },
];

/** 类型筛选维度的中文名（无结果 / 计数文案复用）。 */
const TYPE_NAME: Record<Exclude<TypeFilter, 'all'>, string> = {
  concept: '概念',
  note: '记录',
  meeting: '会议',
};

interface Props {
  q: string;
  hits: SearchHit[];
  semanticUsed: boolean;
  domain: string | null;
  tag: string | null;
  mode: SearchMode;
  /** V22 类型筛选（全部 / 概念 / 记录），由页面按 kind 过滤后传入当前值。 */
  type: TypeFilter;
  domainOptions: string[];
  tagOptions: string[];
  modeLabels: Record<SearchMode, string>;
}

/** 构造保留 q 的搜索 URL（可覆盖 type / domain / tag / mode；空值/默认值省略以保持简洁）。 */
function searchHref(
  q: string,
  type: TypeFilter,
  domain: string | null,
  tag: string | null,
  mode: SearchMode
): string {
  const p = new URLSearchParams();
  p.set('q', q);
  if (type !== 'all') p.set('type', type);
  if (domain) p.set('domain', domain);
  if (tag) p.set('tag', tag);
  if (mode !== 'hybrid') p.set('mode', mode);
  return `/library?${p.toString()}`;
}

export default function SearchResults({
  q,
  hits,
  semanticUsed,
  domain,
  tag,
  mode,
  type,
  domainOptions,
  tagOptions,
  modeLabels,
}: Props) {
  const chipBase =
    'rounded-pill px-2.5 py-1 text-xs font-medium transition focus-visible:outline-none';
  const chipOn = 'bg-brand text-white shadow-sm';
  const chipOff =
    'border border-zinc-200 bg-white text-zinc-600 hover:border-brand hover:text-brand dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300';

  // 是否处于「降级为仅关键词」：mode 非纯关键词、但语义这次没真正跑成（key 失效 / embedding 故障 / 超额）。
  const degraded = !semanticUsed && mode !== 'keyword';

  return (
    <section>
      {/* 结果计数：role=status + aria-live，读屏会在结果刷新后播报「共 N 条结果」 */}
      <div className="mb-3 flex items-center justify-between text-sm text-zinc-400">
        <p role="status" aria-live="polite" aria-atomic="true">
          “<span className="font-medium text-zinc-600 dark:text-zinc-300">{q}</span>” 共{' '}
          {hits.length} 条结果
          {type !== 'all' && (
            <span className="text-zinc-400">（仅{TYPE_NAME[type]}）</span>
          )}
        </p>
        <Link
          href="/library"
          className="inline-flex items-center gap-1 rounded-md transition hover:text-zinc-600 focus-visible:outline-none dark:hover:text-zinc-300"
        >
          清除
          <CloseIcon aria-hidden className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* 筛选 chips：类型 + 检索模式 + 领域 + 标签 */}
      <div className="mb-3 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-xs text-zinc-400">类型</span>
          {TYPES.map((t) => (
            <Link
              key={t.key}
              href={searchHref(q, t.key, domain, tag, mode)}
              aria-pressed={type === t.key}
              className={cn(chipBase, type === t.key ? chipOn : chipOff)}
            >
              {t.label}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-xs text-zinc-400">模式</span>
          {MODES.map((m) => (
            <Link
              key={m}
              href={searchHref(q, type, domain, tag, m)}
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
              href={searchHref(q, type, null, tag, mode)}
              aria-pressed={!domain}
              className={cn(chipBase, !domain ? chipOn : chipOff)}
            >
              全部
            </Link>
            {domainOptions.map((d) => (
              <Link
                key={d}
                href={searchHref(q, type, d, tag, mode)}
                aria-pressed={domain === d}
                className={cn(chipBase, domain === d ? chipOn : chipOff, 'max-w-[12rem] truncate')}
              >
                {d}
              </Link>
            ))}
          </div>
        )}
        {tagOptions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-xs text-zinc-400">标签</span>
            <Link
              href={searchHref(q, type, domain, null, mode)}
              aria-pressed={!tag}
              className={cn(chipBase, !tag ? chipOn : chipOff)}
            >
              全部
            </Link>
            {tagOptions.map((t) => (
              <Link
                key={t}
                href={searchHref(q, type, domain, t, mode)}
                aria-pressed={tag === t}
                className={cn(chipBase, tag === t ? chipOn : chipOff, 'max-w-[12rem] truncate')}
              >
                #{t}
              </Link>
            ))}
          </div>
        )}
      </div>

      {degraded && (
        <p
          role="status"
          className="mb-3 flex items-start gap-1.5 rounded-field bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
        >
          <WhyIcon aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            <span className="font-medium">当前仅关键词结果。</span>
            语义搜索暂不可用（未配置或服务未就绪），已自动回退到关键词与标签匹配，结果照常可用。
          </span>
        </p>
      )}

      {hits.length === 0 ? (
        type !== 'all' ? (
          // 类型筛选下无匹配：引导切回「全部」（纯前端筛选，不必换词）。
          <SearchNoResults
            q={q}
            art={<EmptySearch />}
            title={`没有${TYPE_NAME[type]}类结果`}
            description="试试把「类型」切回全部，或换个关键词。"
            resetTypeHref={searchHref(q, 'all', domain, tag, mode)}
          />
        ) : (
          <SearchNoResults
            q={q}
            art={<EmptySearch />}
            title="没找到相关内容"
            description={
              domain || tag
                ? '当前筛选下没有匹配，试试切到「全部」或换个关键词。'
                : '换个关键词、检查错别字，或试试同义词。'
            }
            resetFilterHref={domain || tag ? searchHref(q, type, null, null, mode) : undefined}
          />
        )
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
                aria-label={`${hit.kind === 'concept' ? '概念' : '记录'}：${hit.title}`}
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
                  {/* V30：会议记录在记录命中里额外标注「会议」徽标。 */}
                  {hit.kind === 'note' && hit.isMeeting && <MeetingBadge />}
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
                  <Highlight text={hit.title} query={q} />
                </p>
                {hit.snippet && (
                  <p className="mt-1 break-words text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                    <Highlight text={hit.snippet} query={q} />
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
