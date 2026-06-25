'use client';

/**
 * 设置页「导出我的知识库（按记录）」按钮组（V29 导出与分享）。
 * 点击 GET /api/export?format=json|md，取 blob 后在前端触发文件下载。
 * 用 fetch + blob（而非裸 <a href>）以携带登录 cookie、并能优雅处理错误（含 429 限流文案）。
 * 文件名优先取响应 Content-Disposition，缺则按日期兜底。
 *
 * 与「下载我的全部数据」（/api/export/all，结构化真备份）、「导出知识库 Markdown」
 * （/api/export/markdown，按领域›主题›概念）互补：本组件导出**以记录为中心**的 JSON / Markdown。
 */

import { useState } from 'react';
import { Button, DownloadIcon, useToast } from '@/components/ui';
import { apiFetch } from '@/lib/api';

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const m = /filename="?([^";]+)"?/i.exec(header);
  return m ? m[1] : null;
}

type Fmt = 'json' | 'md';

const FALLBACK_EXT: Record<Fmt, string> = { json: 'json', md: 'md' };

export default function ExportLibraryButtons() {
  const { success, error: toastError } = useToast();
  const [busy, setBusy] = useState<Fmt | null>(null);

  async function exportAs(format: Fmt) {
    setBusy(format);
    try {
      // 导出可能较大：给更长超时；不自动重试（避免大文件重复下载，且 429 不该重试）。
      const res = await apiFetch(`/api/export?format=${format}`, {
        timeoutMs: 60_000,
        retries: 0,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        toastError(text || `导出失败（${res.status}）`);
        return;
      }
      const blob = await res.blob();
      const filename =
        filenameFromDisposition(res.headers.get('Content-Disposition')) ??
        `xiaom-export-${new Date().toISOString().slice(0, 10)}.${FALLBACK_EXT[format]}`;

      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      success(format === 'json' ? '已导出 JSON 备份' : '已导出 Markdown');
    } catch (err) {
      toastError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      <Button
        variant="secondary"
        size="lg"
        fullWidth
        onClick={() => exportAs('json')}
        loading={busy === 'json'}
        disabled={busy !== null}
      >
        {busy === 'json' ? (
          '准备中…'
        ) : (
          <>
            <DownloadIcon aria-hidden className="h-4 w-4" />
            JSON 备份
          </>
        )}
      </Button>
      <Button
        variant="secondary"
        size="lg"
        fullWidth
        onClick={() => exportAs('md')}
        loading={busy === 'md'}
        disabled={busy !== null}
      >
        {busy === 'md' ? (
          '准备中…'
        ) : (
          <>
            <DownloadIcon aria-hidden className="h-4 w-4" />
            Markdown
          </>
        )}
      </Button>
    </div>
  );
}
