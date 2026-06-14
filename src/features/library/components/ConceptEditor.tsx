'use client';

/**
 * 概念展示 + 用户修正入口（PRD F2：修正记录写 corrections，回填后续提示词）
 * 可编辑：概念名 / 解释 / 领域 / 主题 → POST /api/library/concept
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Markdown, fieldClass } from '@/components/ui';

export interface EditableConcept {
  id: string;
  name: string;
  explanation: string;
  domain: string;
  topic: string;
}

export default function ConceptEditor({ concept }: { concept: EditableConcept }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
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
      const res = await fetch('/api/library/concept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          conceptId: concept.id,
          name: form.name.trim(),
          explanation: form.explanation.trim(),
          domain: form.domain.trim(),
          topic: form.topic.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `保存失败（${res.status}）`);
        return;
      }
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <section className="rounded-card border border-zinc-200/80 bg-white p-6 shadow-card dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-start justify-between gap-3">
          <h1 className="break-words text-xl font-bold leading-snug tracking-tight text-zinc-900 dark:text-zinc-50">
            {concept.name}
          </h1>
          <button
            onClick={() => {
              setForm(concept);
              setEditing(true);
            }}
            className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-zinc-400 transition hover:bg-zinc-100 hover:text-brand dark:hover:bg-zinc-800"
          >
            ✏️ 修正
          </button>
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

  return (
    <section className="animate-fade-in rounded-card border border-brand/40 bg-white p-6 shadow-card dark:bg-zinc-900">
      <h2 className="mb-3 text-sm font-semibold text-brand">修正概念</h2>
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
          {saving ? '保存中…' : '保存修正'}
        </Button>
        <Button variant="secondary" onClick={() => setEditing(false)} disabled={saving}>
          取消
        </Button>
      </div>
      <p className="mt-2.5 text-xs text-zinc-400">
        修正会被记录，用于改进后续 AI 整理。
      </p>
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
