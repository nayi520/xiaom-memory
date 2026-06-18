'use client';

/**
 * 回收站「清空回收站」按钮（V21 数据管理 & 掌控感）。
 *
 * 一次性永久删除回收站里全部记录——**不可恢复**，故走**强二次确认**：
 *  1) 点「清空回收站」→ 展开确认区，文案明确「此操作不可恢复」并列出将删除的条数；
 *  2) 必须再点「确认清空（N 条）」才真正发请求（POST /api/trash/empty）。
 *
 * 成功后回调 onCleared(deleted) 让父列表清空 UI；失败弹错误文案。
 * 桌面/移动通用（内联确认区，不依赖仅移动端的 BottomSheet）。
 */

import { useState } from 'react';
import { Button, TrashIcon, useToast } from '@/components/ui';
import { apiFetch } from '@/lib/api';

export default function EmptyTrashButton({
  count,
  onCleared,
}: {
  /** 当前回收站条数（用于确认文案；为 0 时父组件不应渲染本按钮）。 */
  count: number;
  /** 清空成功回调（deleted = 实际删除条数）。 */
  onCleared: (deleted: number) => void;
}) {
  const { success, error: toastError } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function empty() {
    setBusy(true);
    try {
      const res = await apiFetch('/api/trash/empty', { method: 'POST', timeoutMs: 30_000 });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        deleted?: number;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        toastError(data.error ?? `清空失败（${res.status}）`);
        return;
      }
      const deleted = data.deleted ?? 0;
      success(deleted > 0 ? `已永久删除 ${deleted} 条` : '回收站已清空');
      setConfirming(false);
      onCleared(deleted);
    } catch (err) {
      toastError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <Button variant="danger" size="md" onClick={() => setConfirming(true)}>
        <TrashIcon aria-hidden className="h-4 w-4" />
        清空回收站
      </Button>
    );
  }

  return (
    <div className="animate-scale-in flex flex-col gap-2.5 rounded-card border border-red-200 bg-red-50/60 p-4 dark:border-red-900/60 dark:bg-red-950/30">
      <p className="text-sm font-medium text-red-700 dark:text-red-300">
        永久删除回收站里全部 {count} 条记录？
      </p>
      <p className="text-xs leading-relaxed text-red-600/80 dark:text-red-400/80">
        此操作<strong>不可恢复</strong>。删除后这些记录将彻底消失，无法找回；派生的概念 / 卡片会保留。
      </p>
      <div className="flex items-center gap-2 pt-0.5">
        <Button variant="dangerSolid" size="md" onClick={empty} loading={busy}>
          {busy ? '清空中…' : `确认清空（${count} 条）`}
        </Button>
        <Button
          variant="secondary"
          size="md"
          disabled={busy}
          onClick={() => setConfirming(false)}
        >
          取消
        </Button>
      </div>
    </div>
  );
}
