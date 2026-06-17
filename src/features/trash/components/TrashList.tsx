'use client';

/**
 * 回收站列表（V10 乐观更新 + V19 移动端滑动操作）——拥有列表数据，恢复 / 永久删除即时从列表
 * 移除，失败回滚复原。列表清空后展示空态。
 *
 * 桌面（精确指针）：卡片内常驻「恢复 / 永久删除」按钮（TrashItemActions），与改版前一致。
 * 移动（触摸屏）  ：用 SwipeableRow——向左滑动露出「恢复 / 删除」快捷操作；卡片内仍保留
 *                   同一组按钮作为可达性兜底（读屏 / 不熟悉手势的用户）。
 *
 * 恢复/永久删除的请求与乐观态集中在本组件（restore/purge），手势与按钮共用同一套逻辑，
 * 不重复实现、不改动后端接口。永久删除走二次确认（移动端用底部 sheet 确认）。
 *
 * 数据由 /trash 服务端页传入（已鉴权 + userId 过滤）；本组件只做 UI 与乐观态，不取数。
 */

import { useCallback, useState } from 'react';
import TrashItemActions from './TrashItemActions';
import { apiFetch } from '@/lib/api';
import {
  EmptyState,
  EmptyTrash,
  NoteTypeIcon,
  WhyIcon,
  RestoreIcon,
  TrashIcon,
  SwipeableRow,
  BottomSheet,
  Button,
  useToast,
} from '@/components/ui';

export interface TrashedNote {
  id: string;
  type: string;
  raw_content: string | null;
  transcript: string | null;
  url: string | null;
  why_important: string | null;
  summary: string | null;
  deleted_at: string;
}

function preview(note: TrashedNote): string {
  const text = note.summary || note.raw_content || note.transcript || note.url || '';
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

export default function TrashList({ initialItems }: { initialItems: TrashedNote[] }) {
  const { success, error: toastError } = useToast();
  const [items, setItems] = useState<TrashedNote[]>(initialItems);
  // 乐观移除的条目暂存，便于失败回滚（id → 原 note 与其在列表中的位置）。
  const [pendingRemoval, setPendingRemoval] = useState<Map<string, { note: TrashedNote; index: number }>>(
    new Map()
  );
  // 移动端「永久删除」二次确认目标（null = 关闭 sheet）。
  const [purgeTarget, setPurgeTarget] = useState<TrashedNote | null>(null);
  const [purging, setPurging] = useState(false);

  const removeOptimistic = useCallback((id: string) => {
    setItems((prev) => {
      const index = prev.findIndex((n) => n.id === id);
      if (index < 0) return prev;
      const note = prev[index];
      setPendingRemoval((m) => new Map(m).set(id, { note, index }));
      return prev.filter((n) => n.id !== id);
    });
  }, []);

  const rollback = useCallback((id: string) => {
    setPendingRemoval((m) => {
      const entry = m.get(id);
      if (entry) {
        setItems((prev) => {
          if (prev.some((n) => n.id === id)) return prev; // 已在列表则不重复插入
          const next = [...prev];
          next.splice(Math.min(entry.index, next.length), 0, entry.note);
          return next;
        });
      }
      const nm = new Map(m);
      nm.delete(id);
      return nm;
    });
  }, []);

  const settle = useCallback((id: string) => {
    setPendingRemoval((m) => {
      const nm = new Map(m);
      nm.delete(id);
      return nm;
    });
  }, []);

  /** 恢复：PATCH action=restore（可逆，无需确认）。乐观移除 + 失败回滚。 */
  const restore = useCallback(
    async (id: string) => {
      removeOptimistic(id);
      try {
        const res = await apiFetch(`/api/notes/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'restore' }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          rollback(id);
          toastError(data.error ?? `恢复失败（${res.status}）`);
          return;
        }
        success('已恢复到知识库');
        settle(id);
      } catch (err) {
        rollback(id);
        toastError(err instanceof Error ? err.message : '网络错误');
      }
    },
    [removeOptimistic, rollback, settle, success, toastError]
  );

  /** 永久删除：DELETE（不可逆）。乐观移除 + 失败回滚。 */
  const purge = useCallback(
    async (id: string) => {
      removeOptimistic(id);
      try {
        const res = await apiFetch(`/api/notes/${id}`, { method: 'DELETE' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          rollback(id);
          toastError(data.error ?? `永久删除失败（${res.status}）`);
          return;
        }
        success('已永久删除');
        settle(id);
      } catch (err) {
        rollback(id);
        toastError(err instanceof Error ? err.message : '网络错误');
      }
    },
    [removeOptimistic, rollback, settle, success, toastError]
  );

  if (items.length === 0) {
    return (
      <EmptyState
        art={<EmptyTrash />}
        title="回收站是空的"
        description="删除的记录会出现在这里，随时可以恢复。"
      />
    );
  }

  return (
    <>
      <ul className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
        {items.map((note) => (
          <li key={note.id} className="animate-fade-in">
            <SwipeableRow
              actions={[
                {
                  key: 'restore',
                  label: '恢复',
                  icon: <RestoreIcon aria-hidden className="h-5 w-5" />,
                  onClick: () => void restore(note.id),
                },
                {
                  key: 'purge',
                  label: '删除',
                  icon: <TrashIcon aria-hidden className="h-5 w-5" />,
                  danger: true,
                  onClick: () => setPurgeTarget(note),
                },
              ]}
            >
              <div className="rounded-card border border-zinc-200/80 bg-white px-4 py-3.5 text-sm shadow-card dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 shrink-0 text-zinc-400 dark:text-zinc-500">
                    <NoteTypeIcon type={note.type} className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words leading-relaxed text-zinc-700 dark:text-zinc-200">
                      {preview(note) || '（无文字内容）'}
                    </p>
                    {note.why_important && (
                      <p className="mt-1 flex items-start gap-1 text-xs text-zinc-400">
                        <WhyIcon aria-hidden className="mt-px h-3.5 w-3.5 shrink-0 text-amber-400" />
                        <span className="min-w-0">{note.why_important}</span>
                      </p>
                    )}
                    <p className="mt-1.5 text-xs text-zinc-400">
                      删除于 {new Date(note.deleted_at).toLocaleString('zh-CN')}
                    </p>
                  </div>
                </div>
                {/* 卡片内常驻按钮：桌面主入口；移动端作为手势的可达性兜底。 */}
                <TrashItemActions
                  noteId={note.id}
                  onOptimisticRemove={() => removeOptimistic(note.id)}
                  onRollback={() => rollback(note.id)}
                  onSettled={() => settle(note.id)}
                />
              </div>
            </SwipeableRow>
          </li>
        ))}
      </ul>

      {/* 移动端永久删除确认（底部 sheet）。 */}
      <BottomSheet
        open={purgeTarget !== null}
        onClose={() => !purging && setPurgeTarget(null)}
        title="永久删除这条记录？"
      >
        <p className="px-1 pb-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
          删除后无法恢复。派生的概念 / 卡片会保留。
        </p>
        {purgeTarget && (
          <p className="mb-3 rounded-field bg-zinc-50 px-3 py-2.5 text-sm text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
            {preview(purgeTarget) || '（无文字内容）'}
          </p>
        )}
        <div className="space-y-2 pb-2">
          <Button
            variant="dangerSolid"
            size="lg"
            fullWidth
            loading={purging}
            onClick={async () => {
              if (!purgeTarget) return;
              setPurging(true);
              await purge(purgeTarget.id);
              setPurging(false);
              setPurgeTarget(null);
            }}
          >
            {purging ? '删除中…' : '确认永久删除'}
          </Button>
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            disabled={purging}
            onClick={() => setPurgeTarget(null)}
          >
            取消
          </Button>
        </div>
      </BottomSheet>
    </>
  );
}
