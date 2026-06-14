'use client';

/**
 * 设置页「导出 Markdown」按钮（V4）。
 * 点击 GET /api/export/markdown（text/markdown），取 blob 后在前端触发 .md 文件下载。
 * 用 fetch + blob（而非裸 <a href>）以携带登录 cookie、并能优雅处理错误。
 * 文件名优先取响应 Content-Disposition，缺则按日期兜底。
 */

import { useState } from 'react';
import { Button } from '@/components/ui';

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const m = /filename="?([^";]+)"?/i.exec(header);
  return m ? m[1] : null;
}

export default function ExportMarkdownButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exportMd() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/export/markdown');
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        setError(text || `导出失败（${res.status}）`);
        return;
      }
      const blob = await res.blob();
      const filename =
        filenameFromDisposition(res.headers.get('Content-Disposition')) ??
        `xiaom-knowledge-${new Date().toISOString().slice(0, 10)}.md`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        variant="secondary"
        size="lg"
        fullWidth
        onClick={exportMd}
        loading={busy}
      >
        {busy ? '导出中…' : '导出 Markdown'}
      </Button>
      {error && (
        <p
          role="alert"
          className="animate-fade-in rounded-card border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
        >
          {error}
        </p>
      )}
    </div>
  );
}
