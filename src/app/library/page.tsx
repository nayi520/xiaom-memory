/**
 * 知识库（F4.1 + F4.2）
 * 领域 → 主题 → 概念 → 原始记录 四层下钻（后两层在概念详情页），每层显示数量。
 * 顶部单一搜索框：关键词 ILIKE + 标签精确 + pgvector 语义，合并去重标注来源。
 * 下钻状态用 searchParams 表达（?domain=&topic=），移动端返回手势/返回键天然可用。
 */

import Link from 'next/link';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { concepts as conceptsTable, noteConcepts, notes } from '@/lib/db/schema';
import { runLibrarySearch } from '@/features/library/search';
import SearchResults from '@/features/library/components/SearchResults';
import { PageShell, EmptyState, cardClass, cn } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: '知识库 · 小M' };

const UNCATEGORIZED = '未分类';

interface ConceptRow {
  id: string;
  name: string;
  domain: string | null;
  topic: string | null;
  created_at: string;
}

interface Props {
  searchParams: { q?: string; domain?: string; topic?: string };
}

export default async function LibraryPage({ searchParams }: Props) {
  const user = await getCurrentUser();
  const db = getDb();
  const q = (searchParams.q ?? '').trim();
  const domain = searchParams.domain?.trim() || null;
  const topic = searchParams.topic?.trim() || null;

  // ---- 搜索模式 ----
  if (q) {
    const result = user
      ? await runLibrarySearch(db, user.id, q)
      : { hits: [], semanticUsed: false };
    return (
      <Shell q={q}>
        <SearchResults q={q} hits={result.hits} semanticUsed={result.semanticUsed} />
      </Shell>
    );
  }

  // 未登录：空库（中间件已会拦截，这里仅类型与降级兜底）
  if (!user) {
    return (
      <Shell q={q}>
        <DrillList empty="请先登录。" items={[]} />
      </Shell>
    );
  }

  // ---- 下钻模式：一次取全量概念 + 记录关联数（个人库数据量小，内存聚合即可） ----
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

  // ---- 第三层：概念列表 ----
  if (domain && topic) {
    const list = concepts.filter((c) => domainOf(c) === domain && topicOf(c) === topic);
    return (
      <Shell q={q}>
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

  // ---- 第二层：主题列表 ----
  if (domain) {
    const topics = new Map<string, number>();
    for (const c of concepts) {
      if (domainOf(c) !== domain) continue;
      const t = topicOf(c);
      topics.set(t, (topics.get(t) ?? 0) + 1);
    }
    return (
      <Shell q={q}>
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

  // ---- 第一层：领域列表 ----
  const domains = new Map<string, { topics: Set<string>; concepts: number }>();
  for (const c of concepts) {
    const d = domainOf(c);
    if (!domains.has(d)) domains.set(d, { topics: new Set(), concepts: 0 });
    const entry = domains.get(d)!;
    entry.topics.add(topicOf(c));
    entry.concepts += 1;
  }
  return (
    <Shell q={q}>
      <DrillList
        empty="知识库还是空的——先去记点东西，AI 整理后会自动归类到这里。"
        items={Array.from(domains.entries()).map(([d, info]) => ({
          key: d,
          href: `/library?domain=${encodeURIComponent(d)}`,
          title: d,
          subtitle: `${info.topics.size} 个主题`,
          count: info.concepts,
          unit: '个概念',
        }))}
      />
    </Shell>
  );
}

// ============ 布局壳：标题 + 搜索框 ============

function Shell({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <PageShell width="wide">
      <header className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          知识库
        </h1>
        <p className="mt-1 text-sm text-zinc-400">AI 整理后的概念，按领域 › 主题 › 概念下钻</p>
      </header>

      <form action="/library" method="get" className="mb-5">
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-zinc-400">
            <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" aria-hidden>
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
              <path d="m20 20-3-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
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

      <div className="flex-1">{children}</div>
    </PageShell>
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
          <span className="text-zinc-300 dark:text-zinc-600" aria-hidden>
            ›
          </span>
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

// ============ 下钻列表（大点击区，单手友好） ============

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
        icon="📚"
        title="这里还是空的"
        description={empty}
      />
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
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
              <span
                aria-hidden
                className="text-zinc-300 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand dark:text-zinc-600"
              >
                ›
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
