'use client';

/**
 * 概念详情「删除卡片」入口（V7 卡片管理）。
 * 点击 → 二次确认（强调「永久删除，不可恢复」，区别于复习页的「暂停」保留语义）
 * → DELETE /api/cards/{id} → 成功后 toast + router.refresh()（服务端重取卡片列表）。
 *
 * 归属校验在服务端按 card→concept→userId 完成；此处只负责交互与刷新。
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, TrashIcon, useToast } from '@/components/ui';
import { apiFetch } from '@/lib/api';

export default function CardDeleteButton({ cardId }: { cardId: string }) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/cards/${cardId}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toastError((data as { error?: string }).error ?? `删除失败（${res.status}）`);
        setBusy(false);
        return;
      }
      success('卡片已永久删除');
      router.refresh();
    } catch (err) {
      toastError(err instanceof Error ? err.message : '网络错误');
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-zinc-400 transition hover:text-red-500 focus-visible:outline-none"
        aria-label="删除这张卡片"
        title="删除卡片"
      >
        <TrashIcon aria-hidden className="h-3.5 w-3.5" />
        删除
      </button>
    );
  }

  return (
    <div className="animate-scale-in flex flex-col items-end gap-1.5">
      <p className="text-xs font-medium text-red-500">永久删除？不可恢复。</p>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="dangerSolid" onClick={remove} loading={busy}>
          {busy ? '删除中…' : '确认删除'}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>
          取消
        </Button>
      </div>
    </div>
  );
}
