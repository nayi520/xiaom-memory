'use client';

/**
 * 概念展示 + 管理（V8 概念管理：编辑 / 重命名 / 合并）
 *   - 编辑：概念名 / 解释 / 领域 / 主题 → PATCH /api/library/concept/{id}
 *     （服务端同时写 corrections，回填后续提示词，沿用 F2 修正语义）。
 *   - 合并：把本概念合并进另一概念 → POST /api/library/concept/{id}/merge
 *     （目标用关键词搜索选取；合并后本概念被删除，跳转到目标概念）。
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Button,
  Markdown,
  EditIcon,
  CloseIcon,
  SearchIcon,
  useToast,
  fieldClass,
  cn,
} from '@/components/ui';

export interface EditableConcept {
  id: string;
  name: string;
  explanation: string;
  domain: string;
  topic: string;
}

interface MergeCandidate {
  id: string;
  title: string;
}

export default function ConceptEditor({ concept }: { concept: EditableConcept }) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [mode, setMode] = useState<'view' | 'edit' | 'merge'>('view');
  const [saving, setSaving] = useState(false);
  // 仅保留关键行内校验（概念名为空）；服务端错误/成功走 toast。
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(concept);

  async function save() {
    if (!form.name.trim()) {
      setError('概念名不能为空');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/library/concept/${concept.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          summary: form.explanation.trim(),
          domain: form.domain.trim(),
          topic: form.topic.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toastError(data.error ?? `保存失败（${res.status}）`);
        return;
      }
      setMode('view');
      success('已保存');
      router.refresh();
    } catch (err) {
      toastError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setSaving(false);
    }
  }

  if (mode === 'merge') {
    return (
      <MergePanel
        concept={concept}
        onClose={() => setMode('view')}
        onMerged={(targetId) => {
          success('概念已合并');
          router.replace(`/library/concept/${targetId}`);
          router.refresh();
        }}
      />
    );
  }

  if (mode === 'view') {
    return (
      <section className="rounded-card border border-zinc-200/80 bg-white p-6 shadow-card dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-start justify-between gap-3">
          <h1 className="break-words text-xl font-bold leading-snug tracking-tight text-zinc-900 dark:text-zinc-50">
            {concept.name}
          </h1>
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => {
                setForm(concept);
                setError(null);
                setMode('edit');
              }}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-zinc-400 transition hover:bg-zinc-100 hover:text-brand focus-visible:outline-none dark:hover:bg-zinc-800"
            >
              <EditIcon aria-hidden className="h-3.5 w-3.5" />
              编辑
            </button>
            <button
              onClick={() => setMode('merge')}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-zinc-400 transition hover:bg-zinc-100 hover:text-brand focus-visible:outline-none dark:hover:bg-zinc-800"
            >
              <MergeGlyph />
              合并
            </button>
          </div>
        </div>
        {concept.explanation && (
          <Markdown
            content={concept.explanation}
            className="mt-2.5 text-zinc-700 dark:text-zinc-200"
          />
        )}
      </section>
    );
  }

  // mode === 'edit'
  return (
    <section className="animate-fade-in rounded-card border border-brand/40 bg-white p-6 shadow-card dark:bg-zinc-900">
      <h2 className="mb-3 text-sm font-semibold text-brand">编辑概念</h2>
      <div className="space-y-3">
        <Field label="概念名">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className={inputCls}
          />
        </Field>
        <Field label="解释">
          <textarea
            value={form.explanation}
            onChange={(e) => setForm({ ...form, explanation: e.target.value })}
            rows={4}
            className={inputCls}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="领域">
            <input
              value={form.domain}
              onChange={(e) => setForm({ ...form, domain: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="主题">
            <input
              value={form.topic}
              onChange={(e) => setForm({ ...form, topic: e.target.value })}
              className={inputCls}
            />
          </Field>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

      <div className="mt-4 flex gap-2">
        <Button onClick={save} loading={saving} fullWidth>
          {saving ? '保存中…' : '保存'}
        </Button>
        <Button variant="secondary" onClick={() => setMode('view')} disabled={saving}>
          取消
        </Button>
      </div>
      <p className="mt-2.5 text-xs text-zinc-400">
        修改会被记录，用于改进后续 AI 整理。
      </p>
    </section>
  );
}

// ============ 合并面板：搜索目标概念 → 确认合并 ============

function MergePanel({
  concept,
  onClose,
  onMerged,
}: {
  concept: EditableConcept;
  onClose: () => void;
  onMerged: (targetId: string) => void;
}) {
  const { error: toastError } = useToast();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MergeCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [target, setTarget] = useState<MergeCandidate | null>(null);
  const [merging, setMerging] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 关键词搜索目标概念（仅概念类命中，排除自身）。
  useEffect(() => {
    const q = query.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/library/search?mode=keyword&q=${encodeURIComponent(q)}`
        );
        const data = await res.json();
        const list: MergeCandidate[] = (data.results ?? [])
          .filter((r: { kind: string; id: string }) => r.kind === 'concept' && r.id !== concept.id)
          .map((r: { id: string; title: string }) => ({ id: r.id, title: r.title }))
          .slice(0, 8);
        setResults(list);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 280);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, concept.id]);

  async function doMerge() {
    if (!target) return;
    setMerging(true);
    try {
      const res = await fetch(`/api/library/concept/${concept.id}/merge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetId: target.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        toastError(data.error ?? `合并失败（${res.status}）`);
        setMerging(false);
        return;
      }
      onMerged(target.id);
    } catch (err) {
      toastError(err instanceof Error ? err.message : '网络错误');
      setMerging(false);
    }
  }

  return (
    <section className="animate-fade-in rounded-card border border-amber-400/50 bg-white p-6 shadow-card dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-amber-600 dark:text-amber-400">合并概念</h2>
        <button
          onClick={onClose}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
        >
          <CloseIcon aria-hidden className="h-3.5 w-3.5" />
          取消
        </button>
      </div>

      <p className="mb-3 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
        把「<span className="font-medium text-zinc-700 dark:text-zinc-200">{concept.name}</span>」
        的关联记录、复习卡与关联关系并入目标概念，随后<span className="font-medium text-amber-600 dark:text-amber-400">删除本概念</span>。此操作不可撤销。
      </p>

      {target ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 rounded-field border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 dark:border-zinc-700 dark:bg-zinc-800/60">
            <span className="min-w-0">
              <span className="block text-xs text-zinc-400">合并到</span>
              <span className="block truncate font-semibold text-zinc-800 dark:text-zinc-100">
                {target.title}
              </span>
            </span>
            <button
              onClick={() => setTarget(null)}
              className="shrink-0 rounded-md px-2 py-1 text-xs text-zinc-400 transition hover:text-brand"
            >
              换一个
            </button>
          </div>
          <div className="flex gap-2">
            <Button onClick={doMerge} loading={merging} fullWidth>
              {merging ? '合并中…' : '确认合并'}
            </Button>
            <Button variant="secondary" onClick={onClose} disabled={merging}>
              取消
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-zinc-400">
              <SearchIcon aria-hidden className="h-4 w-4" />
            </span>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索要合并到的目标概念…"
              className={fieldClass('py-2.5 pl-9 pr-3 text-sm dark:bg-zinc-800')}
            />
          </div>
          <div className="mt-2 min-h-[2rem]">
            {searching ? (
              <p className="px-1 py-2 text-xs text-zinc-400">搜索中…</p>
            ) : query.trim() && results.length === 0 ? (
              <p className="px-1 py-2 text-xs text-zinc-400">没有匹配的概念。</p>
            ) : (
              <ul className="space-y-1">
                {results.map((r) => (
                  <li key={r.id}>
                    <button
                      onClick={() => setTarget(r)}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-field px-3 py-2 text-left text-sm transition',
                        'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800'
                      )}
                    >
                      <span className="truncate">{r.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            找不到？先到{' '}
            <Link href="/library" className="text-brand hover:underline">
              知识库
            </Link>{' '}
            确认目标概念已存在。
          </p>
        </>
      )}
    </section>
  );
}

const inputCls = fieldClass('px-3 py-2.5 text-sm dark:bg-zinc-800');

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

/** 合并图标（lucide 未导出 merge 类，用简洁内联 SVG，与线性图标语言一致）。 */
function MergeGlyph() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
    >
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M6 9v6" />
      <path d="M18 12a9 9 0 0 1-9 9" />
      <path d="M9 3a9 9 0 0 1 9 9" />
      <circle cx="18" cy="12" r="3" />
    </svg>
  );
}
