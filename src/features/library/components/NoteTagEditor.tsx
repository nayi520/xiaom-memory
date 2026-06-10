'use client';

/**
 * 记录标签编辑（用户修正入口）：改动写 corrections（target_type=note, field=tags）。
 * POST /api/library/note-tags
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function NoteTagEditor({
  noteId,
  tags,
}: {
  noteId: string;
  tags: string[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState('');

  async function save() {
    const next = Array.from(
      new Set(
        value
          .split(/[,，、\s]+/)
          .map((t) => t.trim().replace(/^#/, ''))
          .filter(Boolean)
      )
    );
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/library/note-tags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ noteId, tags: next }),
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
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.length === 0 ? (
          <span className="text-sm text-zinc-400">暂无标签</span>
        ) : (
          tags.map((t) => (
            <span
              key={t}
              className="rounded-full bg-brand-light px-2.5 py-1 text-xs text-brand dark:bg-zinc-800 dark:text-zinc-300"
            >
              #{t}
            </span>
          ))
        )}
        <button
          onClick={() => {
            setValue(tags.join('，'));
            setEditing(true);
          }}
          className="rounded-lg px-2 py-1 text-xs text-zinc-400 transition active:text-zinc-600"
        >
          ✏️ 修正
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-brand/40 bg-white p-4 dark:bg-zinc-900">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="标签用逗号分隔，如：心理学，决策偏差"
        className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-brand dark:border-zinc-700 dark:bg-zinc-800"
      />
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-semibold text-white transition active:opacity-80 disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存修正'}
        </button>
        <button
          onClick={() => setEditing(false)}
          disabled={saving}
          className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm text-zinc-500 transition active:bg-zinc-50 dark:border-zinc-700"
        >
          取消
        </button>
      </div>
      <p className="mt-2 text-xs text-zinc-400">修正会被记录，用于改进后续 AI 整理。</p>
    </div>
  );
}
