/**
 * 时间线（V4 留存 · V30 类型筛选）
 * 按时间倒序浏览全部未删记录，游标分页「加载更多」。
 * 取数走 /api/notes/timeline（已做鉴权 + userId 过滤）；正文用设计系统 Markdown 渲染。
 * 入口：知识库页右上「时间线」。
 *
 * V30：顶部「类型」筛选 chips（全部 / 文本 / 语音 / 会议 / 链接 / 图片），URL 驱动（?type=）。
 *   - 「会议」= 长语音（type='voice' 且转写字数 ≥ 阈值），由 API 用 SQL 判定，不拉整段 transcript。
 *   - ?type=voice 仍含全部语音（含会议）；?type=meeting 仅会议。筛选值透传给 feed → API。
 */

import Link from 'next/link';
import TimelineFeed from '@/features/timeline/components/TimelineFeed';
import { PageShell, cn } from '@/components/ui';

export const metadata = { title: '时间线 · 小M' };

/** 记录类型筛选维度（与 /api/notes/timeline 的 ?type 契约一致；meeting 为派生维度）。 */
const TYPE_FILTERS = ['text', 'voice', 'meeting', 'link', 'image'] as const;
type TypeFilter = (typeof TYPE_FILTERS)[number];
const TYPE_LABELS: Record<TypeFilter, string> = {
  text: '文本',
  voice: '语音',
  meeting: '会议',
  link: '链接',
  image: '图片',
};
function normalizeType(raw: string | undefined): TypeFilter | null {
  return raw && (TYPE_FILTERS as readonly string[]).includes(raw)
    ? (raw as TypeFilter)
    : null;
}

interface Props {
  searchParams: { type?: string };
}

export default function TimelinePage({ searchParams }: Props) {
  const activeType = normalizeType(searchParams.type);

  const chipBase =
    'rounded-pill px-2.5 py-1 text-xs font-medium transition focus-visible:outline-none';
  const chipOn = 'bg-brand text-white shadow-sm';
  const chipOff =
    'border border-zinc-200 bg-white text-zinc-600 hover:border-brand hover:text-brand dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300';

  return (
    <PageShell width="wide">
      <header className="mb-5 flex items-start justify-between gap-3 lg:mb-7">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 lg:text-3xl dark:text-zinc-50">
            时间线
          </h1>
          <p className="mt-1 text-sm text-zinc-400">所有记录，按时间倒序</p>
        </div>
        <Link
          href="/library"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-field border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-brand hover:text-brand dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
        >
          知识库
        </Link>
      </header>

      {/* V30 类型筛选 chips：URL 驱动（?type=），「全部」清除筛选；移动端可横向换行不挤。 */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <span className="mr-0.5 text-xs text-zinc-400">类型</span>
        <Link
          href="/timeline"
          aria-pressed={!activeType}
          className={cn(chipBase, !activeType ? chipOn : chipOff)}
        >
          全部
        </Link>
        {TYPE_FILTERS.map((t) => (
          <Link
            key={t}
            href={`/timeline?type=${t}`}
            aria-pressed={activeType === t}
            className={cn(chipBase, activeType === t ? chipOn : chipOff)}
          >
            {TYPE_LABELS[t]}
          </Link>
        ))}
      </div>

      {/* key 让切换筛选时重置 feed 内部分页/选择态，重新从首页拉对应类型。 */}
      <TimelineFeed key={activeType ?? 'all'} type={activeType} />
    </PageShell>
  );
}
