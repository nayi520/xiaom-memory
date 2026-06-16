'use client';

/**
 * 设置页「导出 Anki」按钮（V15）。
 * 点击 GET /api/export/anki（text/csv），取 blob 后在前端触发 .csv 下载。
 * 用 fetch + blob（而非裸 <a href>）以携带登录 cookie、并能优雅处理错误。
 * 导出的 CSV 顶部带 Anki import 头注释，Anki「文件 → 导入」即识别。
 */

import { useState } from 'react';
import { Button, useToast } from '@/components/ui';

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const m = /filename="?([^";]+)"?/i.exec(header);
  return m ? m[1] : null;
}

export default function ExportAnkiButton() {
  const { success, error: toastError } = useToast();
  const [busy, setBusy] = useState(false);

  async function exportAnki() {
    setBusy(true);
    try {
      const res = await fetch('/api/export/anki');
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        toastError(text || `导出失败（${res.status}）`);
        return;
      }
      const blob = await res.blob();
      const filename =
        filenameFromDisposition(res.headers.get('Content-Disposition')) ??
        `xiaom-anki-${new Date().toISOString().slice(0, 10)}.csv`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      success('已导出 Anki CSV 文件');
    } catch (err) {
      toastError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="secondary"
      size="lg"
      fullWidth
      onClick={exportAnki}
      loading={busy}
    >
      {busy ? '导出中…' : '导出 Anki（CSV）'}
    </Button>
  );
}
