/**
 * 知识库（F4.1 + F4.2 + V8）
 * 三种浏览模式（顶部切换，?view=）：
 *   - drill（默认）：领域 → 主题 → 概念 → 原始记录 四层下钻（桌面主从双栏 + 领域左栏）。
 *   - tree        ：领域 → 主题 聚合总览（分组卡片 + 数量徽标），一屏俯瞰整库结构。
 *   - graph       ：概念关系图谱（力导向图，client-only canvas，按领域着色、点击跳概念）。
 * 顶部单一搜索框：混合检索（关键词 ILIKE + 标签精确 + pgvector 语义，融合排序），
 *   支持 ?domain= 领域筛选 与 ?mode= 检索模式，结果区提供筛选 chips。
 * 下钻 / 搜索状态用 searchParams 表达，移动端返回手势/返回键天然可用。
 *
 * 响应式：
 *   移动（< lg）：单列下钻——根层显示领域卡片，再逐层进入主题/概念，配合面包屑返回。
 *   桌面（lg+） ：drill 模式主从双栏——左侧常驻「领域」导航面板，右侧主题/概念列表。
 */

import Link from 'next/link';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { concepts as conceptsTable, noteConcepts, notes } from '@/lib/db/schema';
import { normalizeMode, runLibrarySearch, type SearchMode } from '@/features/library/search';
import SearchResults from '@/features/library/components/SearchResults';
import ConceptGraphPanel from '@/features/library/components/ConceptGraphPanel';
import {
  PageShell,
  EmptyState,
  EmptyLibrary,
  LibraryIcon,
  SearchIcon,
  ClockIcon,
  AskIcon,
  ChevronRight,
  cardClass,
  cn,
} from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: '知识库 · 小M' };

const UNCATEGORIZED = '未分类';

type ViewMode = 'drill' | 'tree' | 'graph';
function normalizeView(raw: string | undefined): ViewMode {
  return raw === 'tree' || raw === 'graph' ? raw : 'drill';
}

const MODE_LABELS: Record<SearchMode, string> = {
  hybrid: '混合',
  keyword: '关键词',
  semantic: '语义',
};

interface ConceptRow {
  id: string;
  name: string;
  domain: string | null;
  topic: string | null;
  created_at: string;
}

interface DomainSummary {
  name: string;
  topics: number;
  concepts: number;
}

interface Props {
  searchParams: { q?: string; domain?: string; topic?: string; view?: string; mode?: string };
}

export default async function LibraryPage({ searchParams }: Props) {
  const user = await getCurrentUser();
  const db = getDb();
  const q = (searchParams.q ?? '').trim();
  const domain = searchParams.domain?.trim() || null;
  const topic = searchParams.topic?.trim() || null;
  const view = normalizeView(searchParams.view);
  const mode = normalizeMode(searchParams.mode);

  // ---- 搜索模式（优先级最高；domain 作为筛选条件，mode 选择检索路） ----
  if (q) {
    const result = user
      ? await runLibrarySearch(db, user.id, { q, domain, mode })
      : { hits: [], semanticUsed: false };
    // 取领域清单供筛选 chips（与下钻同口径：本人全部概念的去重领域）。
    const domainOptions = user ? await listDomains(db, user.id) : [];
    return (
      <Shell q={q} view={view} domains={[]} activeDomain={null}>
        <SearchResults
          q={q}
          hits={result.hits}
          semanticUsed={result.semanticUsed}
          domain={domain}
          mode={mode}
          domainOptions={domainOptions}
          modeLabels={MODE_LABELS}
        />
      </Shell>
    );
  }

  // 未登录：空库（中间件已会拦截，这里仅类型与降级兜底）
  if (!user) {
    return (
      <Shell q={q} view={view} domains={[]} activeDomain={null}>
        <DrillList empty="请先登录。" items={[]} />
      </Shell>
    );
  }

  // ---- 图谱模式：client-only 力导向图（自行取数 /api/library/graph） ----
  if (view === 'graph') {
    return (
      <Shell q={q} view={view} domains={[]} activeDomain={null}>
        <ConceptGraphPanel />
      </Shell>
    );
  }

  // ---- 取全量概念 + 记录关联数（个人库数据量小，内存聚合即可；drill/tree 共用） ----
  // 显式按 user_id 过滤（原靠 RLS）；note_concepts 内连接 notes 过滤 deleted_at is null：
  // 回收站内的记录不计入条数。note_concepts 经 concept join 限定到本人概念。
  const [conceptData, ncData] = await Promise.all([
    db
      .select({
        id: conceptsTable.id,
        name: conceptsTable.name,
        domain: conceptsTable.domain,
        topic: conceptsTable.topic,
        created_at: conceptsTable.createdAt,
      })
      .from(conceptsTable)
      .where(eq(conceptsTable.userId, user.id))
      .orderBy(desc(conceptsTable.createdAt)),
    db
      .select({ concept_id: noteConcepts.conceptId })
      .from(noteConcepts)
      .innerJoin(notes, eq(notes.id, noteConcepts.noteId))
      .innerJoin(conceptsTable, eq(conceptsTable.id, noteConcepts.conceptId))
      .where(and(eq(conceptsTable.userId, user.id), isNull(notes.deletedAt))),
  ]);
  const concepts: ConceptRow[] = conceptData.map((c) => ({
    id: c.id,
    name: c.name,
    domain: c.domain,
    topic: c.topic,
    created_at: c.created_at instanceof Date ? c.created_at.toISOString() : String(c.created_at),
  }));
  const noteCount = new Map<string, number>();
  for (const row of ncData) {
    const id = row.concept_id;
    noteCount.set(id, (noteCount.get(id) ?? 0) + 1);
  }
  const domainOf = (c: ConceptRow) => c.domain?.trim() || UNCATEGORIZED;
  const topicOf = (c: ConceptRow) => c.topic?.trim() || UNCATEGORIZED;

  // ---- 领域汇总（桌面左栏常驻 + 根层卡片共用） ----
  const domainMap = new Map<string, { topics: Set<string>; concepts: number }>();
  for (const c of concepts) {
    const d = domainOf(c);
    if (!domainMap.has(d)) domainMap.set(d, { topics: new Set(), concepts: 0 });
    const entry = domainMap.get(d)!;
    entry.topics.add(topicOf(c));
    entry.concepts += 1;
  }
  const domains: DomainSummary[] = Array.from(domainMap.entries()).map(([name, info]) => ({
    name,
    topics: info.topics.size,
    concepts: info.concepts,
  }));

  // ---- 聚合总览模式：领域 → 主题 分组（数量徽标），一屏俯瞰 ----
  if (view === 'tree') {
    const groups = buildDomainTopicGroups(concepts, noteCount, domainOf, topicOf);
    return (
      <Shell q={q} view={view} domains={[]} activeDomain={null}>
        <AggregatedView groups={groups} />
      </Shell>
    );
  }

  // ---- 下钻 · 第三层：概念列表 ----
  if (domain && topic) {
    const list = concepts.filter((c) => domainOf(c) === domain && topicOf(c) === topic);
    return (
      <Shell q={q} view={view} domains={domains} activeDomain={domain}>
        <Breadcrumb
          parts={[
            { label: domain, href: `/library?domain=${encodeURIComponent(domain)}` },
            { label: topic },
          ]}
        />
        <DrillList
          empty="该主题下还没有概念"
          items={list.map((c) => ({
            key: c.id,
            href: `/library/concept/${c.id}`,
            title: c.name,
            count: noteCount.get(c.id) ?? 0,
            unit: '条记录',
          }))}
        />
      </Shell>
    );
  }

  // ---- 下钻 · 第二层：主题列表 ----
  if (domain) {
    const topics = new Map<string, number>();
    for (const c of concepts) {
      if (domainOf(c) !== domain) continue;
      const t = topicOf(c);
      topics.set(t, (topics.get(t) ?? 0) + 1);
    }
    return (
      <Shell q={q} view={view} domains={domains} activeDomain={domain}>
        <Breadcrumb parts={[{ label: domain }]} />
        <DrillList
          empty="该领域下还没有主题"
          items={Array.from(topics.entries()).map(([t, n]) => ({
            key: t,
            href: `/library?domain=${encodeURIComponent(domain)}&topic=${encodeURIComponent(t)}`,
            title: t,
            count: n,
            unit: '个概念',
          }))}
        />
      </Shell>
    );
  }

  // ---- 下钻 · 第一层：领域列表（移动端卡片；桌面端左栏已列出领域，右侧给引导） ----
  return (
    <Shell q={q} view={view} domains={domains} activeDomain={null}>
      {/* 桌面：未选领域时，右侧给一条引导（左栏已是完整领域列表，避免重复罗列） */}
      <div className="hidden lg:block">
        {domains.length === 0 ? (
          <DrillList
            empty="知识库还是空的——先去记点东西，AI 整理后会自动归类到这里。"
            items={[]}
          />
        ) : (
          <EmptyState
            icon={<LibraryIcon aria-hidden className="h-7 w-7" />}
            title="选择一个领域"
            description="从左侧选择领域，查看其下的主题与概念。"
          />
        )}
      </div>
      {/* 移动：领域卡片网格（保持原下钻入口） */}
      <div className="lg:hidden">
        <DrillList
          empty="知识库还是空的——先去记点东西，AI 整理后会自动归类到这里。"
          items={domains.map((d) => ({
            key: d.name,
            href: `/library?domain=${encodeURIComponent(d.name)}`,
            title: d.name,
            subtitle: `${d.topics} 个主题`,
            count: d.concepts,
            unit: '个概念',
          }))}
        />
      </div>
    </Shell>
  );
}

// ============ 取数小工具 ============

/** 本人全部概念的去重领域清单（按名称排序，未分类置末）。 */
async function listDomains(
  db: ReturnType<typeof getDb>,
  userId: string
): Promise<string[]> {
  const rows = await db
    .select({ domain: conceptsTable.domain })
    .from(conceptsTable)
    .where(eq(conceptsTable.userId, userId));
  const set = new Set<string>();
  for (const r of rows) {
    const d = r.domain?.trim();
    if (d) set.add(d);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

interface TopicGroup {
  name: string;
  concepts: { id: string; title: string; noteCount: number }[];
}
interface DomainGroup {
  name: string;
  conceptCount: number;
  topics: TopicGroup[];
}

/** 领域 → 主题 → 概念 分组（概念按记录数降序、再按名称；用于聚合总览）。 */
function buildDomainTopicGroups(
  concepts: ConceptRow[],
  noteCount: Map<string, number>,
  domainOf: (c: ConceptRow) => string,
  topicOf: (c: ConceptRow) => string
): DomainGroup[] {
  const map = new Map<string, Map<string, { id: string; title: string; noteCount: number }[]>>();
  for (const c of concepts) {
    const d = domainOf(c);
    const t = topicOf(c);
    if (!map.has(d)) map.set(d, new Map());
    const topics = map.get(d)!;
    if (!topics.has(t)) topics.set(t, []);
    topics.get(t)!.push({ id: c.id, title: c.name, noteCount: noteCount.get(c.id) ?? 0 });
  }
  return Array.from(map.entries())
    .map(([name, topics]) => {
      const topicGroups: TopicGroup[] = Array.from(topics.entries()).map(([tName, list]) => ({
        name: tName,
        concepts: list.sort((a, b) => b.noteCount - a.noteCount || a.title.localeCompare(b.title, 'zh-CN')),
      }));
      const conceptCount = topicGroups.reduce((sum, t) => sum + t.concepts.length, 0);
      return { name, conceptCount, topics: topicGroups.sort((a, b) => b.concepts.length - a.concepts.length) };
    })
    .sort((a, b) => b.conceptCount - a.conceptCount);
}

// ============ 布局壳：标题 + 视图切换 + 搜索框 + 桌面领域左栏 ============

function Shell({
  q,
  view,
  domains,
  activeDomain,
  children,
}: {
  q: string;
  view: ViewMode;
  domains: DomainSummary[];
  activeDomain: string | null;
  children: React.ReactNode;
}) {
  // 搜索态、tree/graph 视图不分栏；仅 drill 下钻态在桌面用「领域左栏 + 内容」主从布局。
  const railed = !q && view === 'drill' && domains.length > 0;
  return (
    <PageShell width="full">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3 lg:mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 lg:text-3xl dark:text-zinc-50">
            知识库
          </h1>
          <p className="mt-1 text-sm text-zinc-400">AI 整理后的概念，可下钻 / 俯瞰 / 看关系图谱</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/timeline"
            className="inline-flex items-center gap-1.5 rounded-field border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-brand hover:text-brand focus-visible:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
          >
            <ClockIcon aria-hidden className="h-[18px] w-[18px]" />
            时间线
          </Link>
          <Link
            href="/ask"
            className="inline-flex items-center gap-1.5 rounded-field border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-brand hover:text-brand focus-visible:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
          >
            <AskIcon aria-hidden className="h-[18px] w-[18px]" />
            问知识库
          </Link>
        </div>
      </header>

      {/* 视图切换（搜索态隐藏，避免与结果筛选混淆） */}
      {!q && <ViewSwitcher view={view} />}

      <form action="/library" method="get" className="mb-5 lg:max-w-xl">
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-zinc-400">
            <SearchIcon aria-hidden className="h-[18px] w-[18px]" />
          </span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="搜索概念、记录、标签…"
            enterKeyHint="search"
            className="w-full rounded-field border border-zinc-200 bg-white py-3 pl-11 pr-4 text-base shadow-sm outline-none transition duration-150 ease-smooth hover:border-zinc-300 focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600"
          />
        </div>
      </form>

      {railed ? (
        // 主从双栏：左侧领域导航固定档（大屏略增），右侧内容自适应；大屏加大栏间距。
        <div className="flex-1 lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start lg:gap-8 xl:grid-cols-[18rem_minmax(0,1fr)] xl:gap-10">
          <DomainRail domains={domains} active={activeDomain} />
          <div className="min-w-0">{children}</div>
        </div>
      ) : (
        <div className="flex-1">{children}</div>
      )}
    </PageShell>
  );
}

// ============ 视图切换 tabs（下钻 / 聚合 / 图谱） ============

function ViewSwitcher({ view }: { view: ViewMode }) {
  const tabs: { key: ViewMode; label: string; href: string }[] = [
    { key: 'drill', label: '下钻', href: '/library' },
    { key: 'tree', label: '聚合', href: '/library?view=tree' },
    { key: 'graph', label: '图谱', href: '/library?view=graph' },
  ];
  return (
    <div
      role="tablist"
      aria-label="浏览模式"
      className="mb-4 inline-flex rounded-field border border-zinc-200 bg-white p-0.5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
    >
      {tabs.map((t) => {
        const active = view === t.key;
        return (
          <Link
            key={t.key}
            href={t.href}
            role="tab"
            aria-selected={active}
            className={cn(
              'rounded-[10px] px-3.5 py-1.5 text-sm font-medium transition duration-150 ease-smooth focus-visible:outline-none',
              active
                ? 'bg-brand text-white shadow-sm'
                : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100'
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}

// ============ 聚合总览（领域 → 主题，数量徽标） ============

function AggregatedView({ groups }: { groups: DomainGroup[] }) {
  if (groups.length === 0) {
    return (
      <EmptyState
        art={<EmptyLibrary />}
        title="知识库还是空的"
        description="先去记点东西，AI 整理后会自动归类到这里。"
      />
    );
  }
  return (
    <div className="space-y-5">
      {groups.map((d) => (
        <section
          key={d.name}
          className={cn(cardClass({ padded: false }), 'overflow-hidden')}
        >
          <header className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
            <Link
              href={`/library?domain=${encodeURIComponent(d.name)}`}
              className="min-w-0 truncate text-base font-bold text-zinc-900 transition hover:text-brand dark:text-zinc-50 dark:hover:text-brand-100"
            >
              {d.name}
            </Link>
            <span className="shrink-0 rounded-pill bg-zinc-100 px-2 py-0.5 text-xs font-medium tabular-nums text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              {d.topics.length} 主题 · {d.conceptCount} 概念
            </span>
          </header>
          <div className="space-y-3 px-4 py-3.5">
            {d.topics.map((t) => (
              <div key={t.name}>
                <div className="mb-1.5 flex items-center gap-2">
                  <Link
                    href={`/library?domain=${encodeURIComponent(d.name)}&topic=${encodeURIComponent(t.name)}`}
                    className="text-sm font-semibold text-zinc-600 transition hover:text-brand dark:text-zinc-300 dark:hover:text-brand-100"
                  >
                    {t.name}
                  </Link>
                  <span className="text-xs tabular-nums text-zinc-400">{t.concepts.length}</span>
                </div>
                <ul className="flex flex-wrap gap-1.5">
                  {t.concepts.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/library/concept/${c.id}`}
                        className="inline-flex items-center gap-1 rounded-pill border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-700 transition hover:border-brand hover:text-brand dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-brand"
                      >
                        <span className="max-w-[12rem] truncate">{c.title}</span>
                        {c.noteCount > 0 && (
                          <span className="tabular-nums text-zinc-400">{c.noteCount}</span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ============ 桌面领域左栏（常驻，当前领域高亮） ============

function DomainRail({ domains, active }: { domains: DomainSummary[]; active: string | null }) {
  return (
    <nav aria-label="领域" className="hidden lg:block">
      <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        领域 · {domains.length}
      </p>
      <ul className="space-y-1">
        {domains.map((d) => {
          const isActive = active === d.name;
          return (
            <li key={d.name}>
              <Link
                href={`/library?domain=${encodeURIComponent(d.name)}`}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'group flex items-center justify-between gap-2 rounded-field px-3 py-2.5 text-sm transition duration-150 ease-smooth focus-visible:outline-none',
                  isActive
                    ? 'bg-brand/10 font-semibold text-brand dark:bg-brand/15 dark:text-brand-100'
                    : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100'
                )}
              >
                <span className="truncate">{d.name}</span>
                <span
                  className={cn(
                    'shrink-0 tabular-nums text-xs',
                    isActive ? 'text-brand/70 dark:text-brand-100/70' : 'text-zinc-400'
                  )}
                >
                  {d.concepts}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ============ 面包屑 ============

function Breadcrumb({ parts }: { parts: { label: string; href?: string }[] }) {
  return (
    <nav className="mb-4 flex flex-wrap items-center gap-1.5 text-sm text-zinc-400">
      <Link
        href="/library"
        className="rounded-md transition hover:text-brand dark:hover:text-brand-100"
      >
        全部领域
      </Link>
      {parts.map((p) => (
        <span key={p.label} className="flex items-center gap-1.5">
          <ChevronRight aria-hidden className="h-3.5 w-3.5 text-zinc-300 dark:text-zinc-600" />
          {p.href ? (
            <Link
              href={p.href}
              className="rounded-md transition hover:text-brand dark:hover:text-brand-100"
            >
              {p.label}
            </Link>
          ) : (
            <span className="font-medium text-zinc-600 dark:text-zinc-300">{p.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

// ============ 下钻列表（大点击区，单手友好；桌面多列网格利用横向空间） ============

interface DrillItem {
  key: string;
  href: string;
  title: string;
  subtitle?: string;
  count: number;
  unit: string;
}

function DrillList({ items, empty }: { items: DrillItem[]; empty: string }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<LibraryIcon aria-hidden className="h-7 w-7" />}
        title="这里还是空的"
        description={empty}
      />
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <li key={item.key}>
          <Link
            href={item.href}
            className={cn(
              cardClass({ interactive: true, padded: false }),
              'group flex h-full items-center justify-between gap-3 px-4 py-4'
            )}
          >
            <span className="min-w-0">
              <span className="block truncate font-semibold text-zinc-800 dark:text-zinc-100">
                {item.title}
              </span>
              {item.subtitle && (
                <span className="mt-0.5 block text-xs text-zinc-400">{item.subtitle}</span>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-1.5 text-sm text-zinc-400">
              <span className="tabular-nums">
                {item.count} {item.unit}
              </span>
              <ChevronRight
                aria-hidden
                className="h-4 w-4 text-zinc-300 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand dark:text-zinc-600"
              />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
