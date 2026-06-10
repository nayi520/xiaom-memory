/**
 * 知识库（F4.1 + F4.2）
 * 领域 → 主题 → 概念 → 原始记录 四层下钻（后两层在概念详情页），每层显示数量。
 * 顶部单一搜索框：关键词 ILIKE + 标签精确 + pgvector 语义，合并去重标注来源。
 * 下钻状态用 searchParams 表达（?domain=&topic=），移动端返回手势/返回键天然可用。
 */

import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { runLibrarySearch } from '@/features/library/search';
import SearchResults from '@/features/library/components/SearchResults';

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
  const supabase = createClient();
  const q = (searchParams.q ?? '').trim();
  const domain = searchParams.domain?.trim() || null;
  const topic = searchParams.topic?.trim() || null;

  // ---- 搜索模式 ----
  if (q) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const result = user
      ? await runLibrarySearch(supabase, user.id, q)
      : { hits: [], semanticUsed: false };
    return (
      <Shell q={q}>
        <SearchResults q={q} hits={result.hits} semanticUsed={result.semanticUsed} />
      </Shell>
    );
  }

  // ---- 下钻模式：一次取全量概念 + 记录关联数（个人库数据量小，内存聚合即可） ----
  const [{ data: conceptData }, { data: ncData }] = await Promise.all([
    supabase
      .from('concepts')
      .select('id, name, domain, topic, created_at')
      .order('created_at', { ascending: false }),
    supabase.from('note_concepts').select('concept_id'),
  ]);
  const concepts = (conceptData ?? []) as ConceptRow[];
  const noteCount = new Map<string, number>();
  for (const row of ncData ?? []) {
    const id = row.concept_id as string;
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
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 pb-24 pt-6">
      <header className="mb-4">
        <h1 className="text-xl font-bold text-brand">知识库</h1>
      </header>

      <form action="/library" method="get" className="mb-4">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="搜索概念、记录、标签…"
          enterKeyHint="search"
          className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-base outline-none transition focus:border-brand dark:border-zinc-700 dark:bg-zinc-900"
        />
      </form>

      <div className="flex-1">{children}</div>
    </main>
  );
}

// ============ 面包屑 ============

function Breadcrumb({ parts }: { parts: { label: string; href?: string }[] }) {
  return (
    <nav className="mb-3 flex flex-wrap items-center gap-1 text-sm text-zinc-400">
      <Link href="/library" className="transition active:text-zinc-600">
        全部领域
      </Link>
      {parts.map((p) => (
        <span key={p.label} className="flex items-center gap-1">
          <span>›</span>
          {p.href ? (
            <Link href={p.href} className="transition active:text-zinc-600">
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
    return <p className="mt-10 text-center text-sm text-zinc-400">{empty}</p>;
  }
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.key}>
          <Link
            href={item.href}
            className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-4 transition active:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:active:bg-zinc-800"
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{item.title}</span>
              {item.subtitle && (
                <span className="mt-0.5 block text-xs text-zinc-400">{item.subtitle}</span>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-1.5 text-sm text-zinc-400">
              {item.count} {item.unit}
              <span aria-hidden>›</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
