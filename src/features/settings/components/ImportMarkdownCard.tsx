'use client';

/**
 * 设置页「导入 Markdown」卡片（V21 数据管理 & 掌控感）。
 *
 * 让用户把外部 Markdown 导入小M：
 *  - 来源：上传 .md/.txt 文件（读进文本框）或直接粘贴文本。
 *  - 切分规则（用户可选）：
 *      · 按二级标题 `##` 切分为多条（默认，适合一份大纲/合集）；
 *      · 整篇作为一条。
 *  - 提交：POST /api/import/markdown { text, mode }（既有建记录逻辑入库，交由 AI 整理）。
 *  - 反馈：成功「已导入 N 条 / 跳过 M 条」；失败弹错误文案。导入后清空输入。
 *
 * 解析放在后端（规则一处、与 iOS 共用契约）；前端只负责取文本 + 选 mode + 反馈。
 */

import { useRef, useState } from 'react';
import { Button, Textarea, UploadIcon, useToast, cardClass, cn } from '@/components/ui';
import { apiFetch } from '@/lib/api';

type Mode = 'split' | 'single';

export default function ImportMarkdownCard() {
  const { success, error: toastError } = useToast();
  const [text, setText] = useState('');
  const [mode, setMode] = useState<Mode>('split');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // 允许重复选同一文件再次触发 change。
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toastError('文件过大（上限 5MB）');
      return;
    }
    try {
      const content = await file.text();
      setText(content);
    } catch {
      toastError('读取文件失败');
    }
  }

  async function doImport() {
    const trimmed = text.trim();
    if (!trimmed) {
      toastError('请先粘贴或选择 Markdown 内容');
      return;
    }
    setBusy(true);
    try {
      // 导入可能较大且会触发批量写：给更长超时；写操作本就不自动重试。
      const res = await apiFetch('/api/import/markdown', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: trimmed, mode }),
        timeoutMs: 60_000,
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        created?: number;
        skipped?: number;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        toastError(data.error ?? `导入失败（${res.status}）`);
        return;
      }
      const created = data.created ?? 0;
      const skipped = data.skipped ?? 0;
      if (created === 0) {
        toastError(skipped > 0 ? '没有可导入的内容（全部为空段落）' : '没有可导入的内容');
        return;
      }
      success(
        skipped > 0 ? `已导入 ${created} 条，跳过 ${skipped} 条空段落` : `已导入 ${created} 条`
      );
      setText(''); // 导入成功清空，避免误重复导入。
    } catch (err) {
      toastError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn(cardClass(), 'space-y-3')}>
      <input
        ref={fileRef}
        type="file"
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        className="hidden"
        onChange={onPickFile}
      />
      <Textarea
        rows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="粘贴 Markdown 文本，或从下方选择 .md 文件…"
        disabled={busy}
      />

      {/* 切分方式：分段控件（## 多条 / 整篇一条）。 */}
      <div role="radiogroup" aria-label="切分方式" className="flex gap-2">
        {(
          [
            { value: 'split', label: '按 ## 标题分多条' },
            { value: 'single', label: '整篇为一条' },
          ] as const
        ).map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={mode === opt.value}
            disabled={busy}
            onClick={() => setMode(opt.value)}
            className={cn(
              'flex-1 rounded-field border px-3 py-2 text-sm font-medium transition disabled:opacity-60',
              mode === opt.value
                ? 'border-brand bg-brand/5 text-brand dark:bg-brand/10'
                : 'border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-300'
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="flex items-center justify-center gap-2 rounded-field border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/60"
        >
          <UploadIcon aria-hidden className="h-4 w-4" />
          选择文件
        </button>
        <Button size="lg" className="flex-1" onClick={doImport} loading={busy}>
          {busy ? '导入中…' : '导入'}
        </Button>
      </div>
    </div>
  );
}
