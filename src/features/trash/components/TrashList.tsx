'use client';

/**
 * 回收站列表（V10 乐观更新 + V19 移动端滑动操作 + V20 多选批量 / 撤销）——拥有列表数据，
 * 恢复 / 永久删除即时从列表移除，失败回滚复原。列表清空后展示空态。
 *
 * 桌面（精确指针）：卡片内常驻「恢复 / 永久删除」按钮（TrashItemActions），与改版前一致。
 * 移动（触摸屏）  ：用 SwipeableRow——向左滑动露出「恢复 / 删除」快捷操作；卡片内仍保留
 *                   同一组按钮作为可达性兜底（读屏 / 不熟悉手势的用户）。
 *
 * V20：
 *  - 多选：桌面行内勾选 / 移动长按进入选择模式 → 底部工具栏批量「恢复 / 永久删除」（全选/退出）。
 *    批量 = 循环调既有接口（restore/DELETE），并发受限 + 进度/失败计数（见 useNoteBatch）。
 *  - 撤销：单条 / 批量「恢复」后给「已恢复 · 撤销」Toast（反向 trash 回滚）；永久删除不可撤销。
 *
 * 恢复/永久删除的请求与乐观态集中在本组件，手势与按钮共用同一套逻辑，不改后端接口。
 * 永久删除走二次确认（移动端 + 批量用底部 sheet 确认）。数据由 /trash 服务端页传入（已鉴权 + userId 过滤）。
 */

import { useCallback, useMemo, useState } from 'react';
import TrashItemActions from './TrashItemActions';
import { apiFetch } from '@/lib/api';
import {
  useSelection,
  useLongPress,
  useNoteBatch,
  SelectionToolbar,
  SelectCheckbox,
  trashNote,
  restoreNote,
  purgeNote,
} from '@/features/selection';
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
  cn,
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
  const { success, error: toastError, toast } = useToast();
  const [items, setItems] = useState<TrashedNote[]>(initialItems);
  // 乐观移除的条目暂存，便于失败回滚 / 撤销复原（id → 原 note 与其在列表中的位置）。
  const [pendingRemoval, setPendingRemoval] = useState<Map<string, { note: TrashedNote; index: number }>>(
    new Map()
  );
  // 移动端「永久删除」二次确认目标（null = 关闭 sheet）。
  const [purgeTarget, setPurgeTarget] = useState<TrashedNote | null>(null);
  const [purging, setPurging] = useState(false);
  // 批量永久删除确认（选择态）。
  const [purgeBatch, setPurgeBatch] = useState(false);

  const selection = useSelection();
  const batch = useNoteBatch();

  // 已知条目的快照表（用于撤销时把记录放回原列表，即便已从 items 移除）。
  const snapshot = useMemo(() => {
    const m = new Map<string, TrashedNote>();
    initialItems.forEach((n) => m.set(n.id, n));
    return m;
  }, [initialItems]);

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

  /** 把若干条按 deleted_at 倒序放回列表（撤销恢复 / 撤销批量恢复用）。 */
  const reinsert = useCallback(
    (ids: string[]) => {
      setItems((prev) => {
        const existing = new Set(prev.map((n) => n.id));
        const add = ids
          .map((id) => snapshot.get(id))
          .filter((n): n is TrashedNote => !!n && !existing.has(n.id));
        if (add.length === 0) return prev;
        const merged = [...prev, ...add];
        merged.sort(
          (a, b) => new Date(b.deleted_at).getTime() - new Date(a.deleted_at).getTime()
        );
        return merged;
      });
    },
    [snapshot]
  );

  /** 恢复：PATCH action=restore（可逆）。乐观移除 + 失败回滚 + 「撤销」（反向 trash）。 */
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
        settle(id);
        // 「已恢复 · 撤销」：撤销=把这条再 trash 回来并放回列表。
        toast('已恢复到知识库', {
          variant: 'success',
          action: {
            label: '撤销',
            onClick: async () => {
              try {
                await trashNote(id);
                reinsert([id]);
              } catch (err) {
                toastError(err instanceof Error ? err.message : '撤销失败');
              }
            },
          },
        });
      } catch (err) {
        rollback(id);
        toastError(err instanceof Error ? err.message : '网络错误');
      }
    },
    [removeOptimistic, rollback, settle, toast, toastError, reinsert]
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

  // —— 批量：恢复（可撤销）/ 永久删除（确认、不可撤销）——
  const selectedIds = useMemo(() => Array.from(selection.selected), [selection.selected]);

  const batchRestore = useCallback(async () => {
    const ids = selectedIds.filter((id) => items.some((n) => n.id === id));
    if (ids.length === 0) return;
    ids.forEach((id) => removeOptimistic(id));
    selection.exit();
    await batch.run({
      ids,
      run: restoreNote,
      verb: '恢复',
      onItemSettled: (id, ok) => (ok ? settle(id) : rollback(id)),
      undo: { run: trashNote, onUndoUI: reinsert },
    });
  }, [selectedIds, items, removeOptimistic, selection, batch, settle, rollback, reinsert]);

  const batchPurge = useCallback(async () => {
    const ids = selectedIds.filter((id) => items.some((n) => n.id === id));
    if (ids.length === 0) return;
    ids.forEach((id) => removeOptimistic(id));
    selection.exit();
    setPurgeBatch(false);
    await batch.run({
      ids,
      run: purgeNote,
      verb: '永久删除',
      onItemSettled: (id, ok) => (ok ? settle(id) : rollback(id)),
      // 永久删除不可逆：不提供撤销。
    });
  }, [selectedIds, items, removeOptimistic, selection, batch, settle, rollback]);

  if (items.length === 0) {
    return (
      <EmptyState
        art={<EmptyTrash />}
        title="回收站是空的"
        description="删除的记录会出现在这里，随时可以恢复。"
      />
    );
  }

  const allSelected = items.length > 0 && selection.count >= items.length;

  return (
    <>
      <ul className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
        {items.map((note) => (
          <li key={note.id} className="animate-fade-in">
            <TrashRow
              note={note}
              selectionActive={selection.active}
              selected={selection.isSelected(note.id)}
              onToggle={() => selection.toggle(note.id)}
              onLongPress={() => selection.enterWith(note.id)}
              onRestore={() => void restore(note.id)}
              onPurgeRequest={() => setPurgeTarget(note)}
              onOptimisticRemove={() => removeOptimistic(note.id)}
              onRollback={() => rollback(note.id)}
              onSettled={() => settle(note.id)}
            />
          </li>
        ))}
      </ul>

      {/* 选择态底部工具栏：恢复（可撤销）/ 永久删除（确认）。 */}
      {selection.active && (
        <SelectionToolbar
          count={selection.count}
          total={items.length}
          allSelected={allSelected}
          onToggleSelectAll={() =>
            allSelected ? selection.clear() : selection.selectAll(items.map((n) => n.id))
          }
          onExit={selection.exit}
          onRestore={batchRestore}
          onPurge={() => setPurgeBatch(true)}
          busy={batch.busy}
        />
      )}

      {/* 单条永久删除确认（底部 sheet）。 */}
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

      {/* 批量永久删除确认（底部 sheet）。 */}
      <BottomSheet
        open={purgeBatch}
        onClose={() => !batch.busy && setPurgeBatch(false)}
        title={`永久删除选中的 ${selection.count} 条？`}
      >
        <p className="px-1 pb-3 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
          删除后无法恢复（不可撤销）。派生的概念 / 卡片会保留。
        </p>
        <div className="space-y-2 pb-2">
          <Button
            variant="dangerSolid"
            size="lg"
            fullWidth
            loading={batch.busy}
            onClick={batchPurge}
          >
            {batch.busy
              ? `删除中…${batch.progress ? ` ${batch.progress.done}/${batch.progress.total}` : ''}`
              : '确认永久删除'}
          </Button>
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            disabled={batch.busy}
            onClick={() => setPurgeBatch(false)}
          >
            取消
          </Button>
        </div>
      </BottomSheet>
    </>
  );
}

/** 单条回收站记录行：选择态勾选 / 长按进入；非选择态保留滑动 + 卡片内按钮。 */
function TrashRow({
  note,
  selectionActive,
  selected,
  onToggle,
  onLongPress,
  onRestore,
  onPurgeRequest,
  onOptimisticRemove,
  onRollback,
  onSettled,
}: {
  note: TrashedNote;
  selectionActive: boolean;
  selected: boolean;
  onToggle: () => void;
  onLongPress: () => void;
  onRestore: () => void;
  onPurgeRequest: () => void;
  onOptimisticRemove: () => void;
  onRollback: () => void;
  onSettled: () => void;
}) {
  // 长按进入选择模式（触摸屏；非选择态才绑定）。
  const longPress = useLongPress(onLongPress, !selectionActive);

  const card = (
    <div
      {...(selectionActive ? {} : longPress)}
      onClick={selectionActive ? onToggle : undefined}
      className={cn(
        'rounded-card border bg-white px-4 py-3.5 text-sm shadow-card transition dark:bg-zinc-900',
        selected
          ? 'border-brand/50 ring-1 ring-brand/30'
          : 'border-zinc-200/80 dark:border-zinc-800',
        selectionActive && 'cursor-pointer'
      )}
    >
      <div className="flex items-start gap-2.5">
        {selectionActive && (
          <SelectCheckbox checked={selected} onChange={onToggle} className="-ml-1 mt-0.5" />
        )}
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
      {/* 卡片内常驻按钮：桌面主入口；移动端作为手势的可达性兜底。选择态隐藏（避免误触）。 */}
      {!selectionActive && (
        <TrashItemActions
          noteId={note.id}
          onOptimisticRemove={onOptimisticRemove}
          onRollback={onRollback}
          onSettled={onSettled}
        />
      )}
    </div>
  );

  // 选择态：不挂滑动手势（避免与勾选冲突），直接渲染卡片。
  if (selectionActive) return card;

  return (
    <SwipeableRow
      actions={[
        {
          key: 'restore',
          label: '恢复',
          icon: <RestoreIcon aria-hidden className="h-5 w-5" />,
          onClick: onRestore,
        },
        {
          key: 'purge',
          label: '删除',
          icon: <TrashIcon aria-hidden className="h-5 w-5" />,
          danger: true,
          onClick: onPurgeRequest,
        },
      ]}
    >
      {card}
    </SwipeableRow>
  );
}
