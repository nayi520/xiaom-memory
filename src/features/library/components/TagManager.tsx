'use client';

/**
 * 标签管理器（V32）——总览 + 改名 / 合并 / 删除，做知识库卫生。
 *
 * 交互：
 *   - 总览：列出本人全部标签 + 使用计数（未删记录用量），可按「用量 / 名称」排序，标签多时支持搜索过滤。
 *   - 改名：行内输入新名 → POST /api/tags/rename。若新名撞已有标签，后端返回 action:'merge'，
 *           本组件把两者在 UI 上合并（计数相加），并提示「已合并到已有标签 X」。
 *           （为避免「悄悄吞数据」，改名前若本地已知撞名，会先弹确认「将合并到已有标签 X」。）
 *   - 合并：进入多选 → 勾选若干源标签 → 选一个目标 → 确认 → POST /api/tags/merge。
 *   - 删除：行内「删除」二次确认 → POST /api/tags/delete（仅删标签与其关联，记录不动）。
 *
 * 一致性：所有写操作**乐观更新**本地列表，失败回滚到操作前快照并弹错误 toast。
 * 归属与事务由后端保证（严格按 tags.user_id；合并/改名在事务内重指→去重→删旧）。
 */

import { useMemo, useState } from 'react';
import {
  Button,
  Input,
  TagIcon,
  SearchIcon,
  EditIcon,
  TrashIcon,
  CloseIcon,
  CheckIcon,
  useToast,
  cn,
  EmptyState,
} from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { normalizeTagName } from '@/features/library/tag-ops';

export interface TagItem {
  id: string;
  name: string;
  count: number;
}

type SortKey = 'count' | 'name';

/** 列表排序（count 降序→名称；name 按 zh-CN 升序）。纯展示，不改后端口径。 */
function sortTags(tags: TagItem[], key: SortKey): TagItem[] {
  const arr = [...tags];
  if (key === 'name') {
    arr.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  } else {
    arr.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
  }
  return arr;
}

export default function TagManager({ initialTags }: { initialTags: TagItem[] }) {
  const { success, error: toastError } = useToast();
  const [tags, setTags] = useState<TagItem[]>(initialTags);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('count');

  // 合并多选模式：selected = 勾选的源标签 id 集合。
  const [mergeMode, setMergeMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? tags.filter((t) => t.name.toLowerCase().includes(q))
      : tags;
    return sortTags(base, sortKey);
  }, [tags, query, sortKey]);

  const totalCount = tags.length;

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitMergeMode() {
    setMergeMode(false);
    setSelected(new Set());
  }

  // ---- 改名（含撞名→合并）。返回是否成功，供行组件收尾。 ----
  async function handleRename(tag: TagItem, rawNew: string): Promise<boolean> {
    const next = normalizeTagName(rawNew);
    if (!next) {
      toastError('标签名不能为空');
      return false;
    }
    if (next === tag.name) return true; // 无变化，直接收起

    // 本地预判是否撞已有标签（排除自身）→ 先确认「将合并到已有标签 X」。
    const collision = tags.find((t) => t.id !== tag.id && t.name === next);
    if (collision) {
      const ok = window.confirm(
        `已存在标签「${next}」。将把「${tag.name}」的 ${tag.count} 条记录合并到「${next}」，并删除「${tag.name}」。继续？`
      );
      if (!ok) return false;
    }

    const snapshot = tags;
    setBusy(true);
    try {
      const res = await apiFetch('/api/tags/rename', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tagId: tag.id, name: next }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        action?: 'noop' | 'rename' | 'merge';
        name?: string;
        mergedInto?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        toastError(data.error ?? `操作失败（${res.status}）`);
        return false;
      }

      if (data.action === 'merge' && data.mergedInto) {
        // 本标签并入目标：移除本标签，目标计数加上本标签计数（去重后真实值可能略少，刷新即准）。
        setTags((cur) => {
          const targetId = data.mergedInto!;
          return cur
            .filter((t) => t.id !== tag.id)
            .map((t) =>
              t.id === targetId ? { ...t, count: t.count + tag.count } : t
            );
        });
        success(`已合并到「${data.name ?? next}」`);
      } else if (data.action === 'rename') {
        setTags((cur) =>
          cur.map((t) => (t.id === tag.id ? { ...t, name: data.name ?? next } : t))
        );
        success('已改名');
      }
      return true;
    } catch (err) {
      setTags(snapshot);
      toastError(err instanceof Error ? err.message : '网络错误');
      return false;
    } finally {
      setBusy(false);
    }
  }

  // ---- 删除（行内二次确认在行组件里；这里只发请求 + 乐观移除 + 回滚）。 ----
  async function handleDelete(tag: TagItem): Promise<boolean> {
    const snapshot = tags;
    setBusy(true);
    // 乐观移除。
    setTags((cur) => cur.filter((t) => t.id !== tag.id));
    try {
      const res = await apiFetch('/api/tags/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tagId: tag.id }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setTags(snapshot);
        toastError(data.error ?? `删除失败（${res.status}）`);
        return false;
      }
      success(`已删除「${tag.name}」`);
      return true;
    } catch (err) {
      setTags(snapshot);
      toastError(err instanceof Error ? err.message : '网络错误');
      return false;
    } finally {
      setBusy(false);
    }
  }

  // ---- 合并多选 → 选目标 → 提交。 ----
  async function handleMerge(targetId: string) {
    const sourceIds = Array.from(selected).filter((id) => id !== targetId);
    if (sourceIds.length === 0) {
      toastError('请至少选择一个要并入的标签');
      return;
    }
    const target = tags.find((t) => t.id === targetId);
    const sources = tags.filter((t) => sourceIds.includes(t.id));
    const ok = window.confirm(
      `把 ${sources.map((t) => `「${t.name}」`).join('、')} 合并到「${target?.name ?? ''}」？` +
        `\n这些标签将被删除，其记录改挂到「${target?.name ?? ''}」。`
    );
    if (!ok) return;

    const snapshot = tags;
    setBusy(true);
    // 乐观：移除源，目标计数加上源计数之和（去重后真实值可能略少，刷新即准）。
    const addCount = sources.reduce((s, t) => s + t.count, 0);
    setTags((cur) =>
      cur
        .filter((t) => !sourceIds.includes(t.id))
        .map((t) => (t.id === targetId ? { ...t, count: t.count + addCount } : t))
    );
    try {
      const res = await apiFetch('/api/tags/merge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceTagIds: sourceIds, targetTagId: targetId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        merged?: number;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setTags(snapshot);
        toastError(data.error ?? `合并失败（${res.status}）`);
        return;
      }
      success(`已合并 ${data.merged ?? sourceIds.length} 个标签到「${target?.name ?? ''}」`);
      exitMergeMode();
    } catch (err) {
      setTags(snapshot);
      toastError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setBusy(false);
    }
  }

  if (totalCount === 0) {
    return (
      <EmptyState
        icon={<TagIcon aria-hidden className="h-7 w-7" />}
        title="还没有标签"
        description="在记录详情里给记录加标签，之后就能在这里统一管理（改名 / 合并 / 删除）。"
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* 工具条：搜索 + 排序 + 合并入口 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`搜索标签（共 ${totalCount} 个）`}
            aria-label="搜索标签"
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <div
            role="group"
            aria-label="排序方式"
            className="inline-flex overflow-hidden rounded-field border border-zinc-200 dark:border-zinc-700"
          >
            {(
              [
                { key: 'count' as const, label: '用量' },
                { key: 'name' as const, label: '名称' },
              ]
            ).map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSortKey(s.key)}
                aria-pressed={sortKey === s.key}
                className={cn(
                  'px-3 py-2 text-xs font-medium transition focus-visible:outline-none',
                  sortKey === s.key
                    ? 'bg-brand text-white'
                    : 'bg-white text-zinc-500 hover:text-brand dark:bg-zinc-900 dark:text-zinc-400'
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
          {mergeMode ? (
            <Button variant="secondary" size="md" onClick={exitMergeMode} disabled={busy}>
              <CloseIcon aria-hidden className="h-4 w-4" />
              退出合并
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="md"
              onClick={() => setMergeMode(true)}
              disabled={busy}
            >
              合并标签
            </Button>
          )}
        </div>
      </div>

      {/* 合并模式说明 + 提交条 */}
      {mergeMode && (
        <MergeBar
          tags={tags}
          selected={selected}
          busy={busy}
          onMerge={handleMerge}
        />
      )}

      {/* 标签列表 */}
      {filtered.length === 0 ? (
        <p className="px-1 py-8 text-center text-sm text-zinc-400">
          没有匹配「{query}」的标签
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((tag) => (
            <TagRow
              key={tag.id}
              tag={tag}
              mergeMode={mergeMode}
              selected={selected.has(tag.id)}
              disabled={busy}
              onToggleSelect={() => toggleSelect(tag.id)}
              onRename={(name) => handleRename(tag, name)}
              onDelete={() => handleDelete(tag)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** 合并模式顶部条：显示已选数量，并提供「选为目标」的目标下拉（从已选中选一个作为保留项）。 */
function MergeBar({
  tags,
  selected,
  busy,
  onMerge,
}: {
  tags: TagItem[];
  selected: Set<string>;
  busy: boolean;
  onMerge: (targetId: string) => void;
}) {
  const selectedTags = tags.filter((t) => selected.has(t.id));
  const [targetId, setTargetId] = useState<string>('');

  // 目标必须是已选之一；若当前目标已被取消勾选，回退为空。
  const effectiveTarget = selected.has(targetId) ? targetId : '';

  return (
    <div className="animate-fade-in rounded-card border border-brand/30 bg-brand-light/50 p-4 dark:border-brand/25 dark:bg-brand/10">
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
        合并标签
      </p>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        勾选两个或多个标签，选一个作为「保留」的目标，其余将并入它并删除。记录会改挂到目标标签。
      </p>
      {selectedTags.length < 2 ? (
        <p className="mt-2.5 text-xs text-zinc-400">
          已选 {selectedTags.length} 个，至少再选 {Math.max(0, 2 - selectedTags.length)} 个。
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
            保留为：
            <select
              value={effectiveTarget}
              onChange={(e) => setTargetId(e.target.value)}
              disabled={busy}
              className="ml-2 rounded-field border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-zinc-700 focus-visible:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
            >
              <option value="">选择目标标签…</option>
              {selectedTags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}（{t.count}）
                </option>
              ))}
            </select>
          </label>
          <Button
            size="md"
            disabled={busy || !effectiveTarget}
            loading={busy}
            onClick={() => effectiveTarget && onMerge(effectiveTarget)}
          >
            合并 {selectedTags.length} 个标签
          </Button>
        </div>
      )}
    </div>
  );
}

/** 单个标签行：展示名 + 计数；普通态可改名 / 删除；合并态显示勾选框。 */
function TagRow({
  tag,
  mergeMode,
  selected,
  disabled,
  onToggleSelect,
  onRename,
  onDelete,
}: {
  tag: TagItem;
  mergeMode: boolean;
  selected: boolean;
  disabled: boolean;
  onToggleSelect: () => void;
  onRename: (name: string) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(tag.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [rowBusy, setRowBusy] = useState(false);

  async function submitRename() {
    setRowBusy(true);
    const ok = await onRename(value);
    setRowBusy(false);
    if (ok) setEditing(false);
  }

  // 合并模式：整行作为可勾选项（大命中区，移动友好）。
  if (mergeMode) {
    return (
      <li>
        <button
          type="button"
          onClick={onToggleSelect}
          disabled={disabled}
          aria-pressed={selected}
          className={cn(
            'flex w-full items-center gap-3 rounded-card border px-4 py-3 text-left transition focus-visible:outline-none disabled:opacity-50',
            selected
              ? 'border-brand bg-brand-light/60 dark:border-brand/60 dark:bg-brand/15'
              : 'border-zinc-200/80 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900'
          )}
        >
          <span
            className={cn(
              'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border',
              selected
                ? 'border-brand bg-brand text-white'
                : 'border-zinc-300 dark:border-zinc-600'
            )}
          >
            {selected && <CheckIcon aria-hidden className="h-3.5 w-3.5" />}
          </span>
          <span className="min-w-0 flex-1 truncate font-medium text-zinc-800 dark:text-zinc-100">
            #{tag.name}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-zinc-400">
            {tag.count} 条
          </span>
        </button>
      </li>
    );
  }

  // 改名态：行内输入。
  if (editing) {
    return (
      <li className="rounded-card border border-brand/40 bg-white p-3 dark:border-brand/40 dark:bg-zinc-900">
        <div className="flex items-center gap-2">
          <Input
            value={value}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void submitRename();
              } else if (e.key === 'Escape') {
                setEditing(false);
                setValue(tag.name);
              }
            }}
            placeholder="新标签名"
            aria-label={`重命名标签 ${tag.name}`}
            className="flex-1"
          />
          <Button size="md" onClick={submitRename} loading={rowBusy}>
            保存
          </Button>
          <Button
            variant="secondary"
            size="md"
            disabled={rowBusy}
            onClick={() => {
              setEditing(false);
              setValue(tag.name);
            }}
          >
            取消
          </Button>
        </div>
        <p className="mt-2 text-xs text-zinc-400">
          若新名已存在，会自动合并到那个标签（记录改挂过去）。
        </p>
      </li>
    );
  }

  // 删除确认态：行内强提示。
  if (confirmDelete) {
    return (
      <li className="animate-scale-in rounded-card border border-red-200 bg-red-50/60 p-3 dark:border-red-900/60 dark:bg-red-950/30">
        <p className="text-sm font-medium text-red-700 dark:text-red-300">
          删除标签「{tag.name}」？
        </p>
        <p className="mt-1 text-xs leading-relaxed text-red-600/80 dark:text-red-400/80">
          将解除它与 {tag.count} 条记录的关联，<strong>记录本身不受影响</strong>。此操作不可撤销。
        </p>
        <div className="mt-2.5 flex items-center gap-2">
          <Button
            variant="dangerSolid"
            size="md"
            loading={rowBusy}
            onClick={async () => {
              setRowBusy(true);
              const ok = await onDelete();
              setRowBusy(false);
              if (!ok) setConfirmDelete(false);
            }}
          >
            确认删除
          </Button>
          <Button
            variant="secondary"
            size="md"
            disabled={rowBusy}
            onClick={() => setConfirmDelete(false)}
          >
            取消
          </Button>
        </div>
      </li>
    );
  }

  // 普通态。
  return (
    <li className="group flex items-center gap-3 rounded-card border border-zinc-200/80 bg-white px-4 py-3 transition hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700">
      <TagIcon aria-hidden className="h-4 w-4 shrink-0 text-brand" />
      <span className="min-w-0 flex-1 truncate font-medium text-zinc-800 dark:text-zinc-100">
        {tag.name}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-zinc-400">
        {tag.count} 条
      </span>
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={() => {
            setValue(tag.name);
            setEditing(true);
          }}
          disabled={disabled}
          aria-label={`重命名 ${tag.name}`}
          className="touch-target flex items-center justify-center rounded-md px-2 py-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-brand focus-visible:outline-none disabled:opacity-50 dark:hover:bg-zinc-800"
        >
          <EditIcon aria-hidden className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          disabled={disabled}
          aria-label={`删除 ${tag.name}`}
          className="touch-target flex items-center justify-center rounded-md px-2 py-1.5 text-zinc-400 transition hover:bg-red-50 hover:text-red-600 focus-visible:outline-none disabled:opacity-50 dark:hover:bg-red-950/50 dark:hover:text-red-400"
        >
          <TrashIcon aria-hidden className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}
