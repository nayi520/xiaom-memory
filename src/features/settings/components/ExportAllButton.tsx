'use client';

/**
 * 设置页「下载我的全部数据」按钮（V21 数据管理 & 掌控感 / PIPL 友好 + 真备份）。
 * 点击 GET /api/export/all（application/json 附件），取 blob 后在前端触发 .json 下载。
 * 用 fetch + blob（而非裸 <a href>）以携带登录 cookie、并能优雅处理错误。
 * 文件名优先取响应 Content-Disposition，缺则按日期兜底。
 */

import { useState } from 'react';
import { Button, DownloadIcon, useToast } from '@/components/ui';
import { apiFetch } from '@/lib/api';

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const m = /filename="?([^";]+)"?/i.exec(header);
  return m ? m[1] : null;
}

export default function ExportAllButton() {
  const { success, error: toastError } = useToast();
  const [busy, setBusy] = useState(false);

  async function exportAll() {
    setBusy(true);
    try {
      // 全量备份可能较大：给更长超时；不自动重试（避免大文件重复下载）。
      const res = await apiFetch('/api/export/all', { timeoutMs: 60_000, retries: 0 });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        toastError(text || `下载失败（${res.status}）`);
        return;
      }
      const blob = await res.blob();
      const filename =
        filenameFromDisposition(res.headers.get('Content-Disposition')) ??
        `xiaom-backup-${new Date().toISOString().slice(0, 10)}.json`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      success('已下载全部数据备份');
    } catch (err) {
      toastError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="secondary" size="lg" fullWidth onClick={exportAll} loading={busy}>
      {busy ? (
        '准备中…'
      ) : (
        <>
          <DownloadIcon aria-hidden className="h-4 w-4" />
          下载我的全部数据
        </>
      )}
    </Button>
  );
}
