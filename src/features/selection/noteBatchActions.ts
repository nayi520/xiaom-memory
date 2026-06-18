'use client';

/**
 * 记录批量操作的「单条」原子调用（V20）——复用既有端点，供 runBatch 循环调用。
 *
 * 不新增任何后端端点：
 *  - 打标签：GET /api/library/note-tags 读当前标签 → 与新标签并集 → POST 整体替换（避免误清空已有标签）。
 *  - 软删 / 恢复：PATCH /api/notes/[id] { action: 'trash' | 'restore' }。
 *  - 永久删除：DELETE /api/notes/[id]（回收站批量永久删除用，二次确认在 UI 层）。
 *
 * 每个函数失败即抛出（带友好文案），由 runBatch 记为失败计数。撤销同样复用 trash/restore 反向调用。
 */

import { apiFetch } from '@/lib/api';

/** 软删一条（移入回收站）。 */
export async function trashNote(id: string): Promise<void> {
  const res = await apiFetch(`/api/notes/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'trash' }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `删除失败（${res.status}）`);
  }
}

/** 恢复一条（从回收站还原；也用作软删的撤销）。 */
export async function restoreNote(id: string): Promise<void> {
  const res = await apiFetch(`/api/notes/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'restore' }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `恢复失败（${res.status}）`);
  }
}

/** 永久删除一条（不可逆；回收站批量永久删除用）。 */
export async function purgeNote(id: string): Promise<void> {
  const res = await apiFetch(`/api/notes/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `永久删除失败（${res.status}）`);
  }
}

/** 读某条记录当前标签（批量打标签时与新标签并集，避免误清空）。失败回退空集。 */
async function getNoteTags(id: string): Promise<string[]> {
  try {
    const res = await apiFetch(`/api/library/note-tags?noteId=${encodeURIComponent(id)}`, {
      retries: 0,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { tags?: string[] };
    return Array.isArray(data.tags) ? data.tags : [];
  } catch {
    return [];
  }
}

/**
 * 给一条记录追加标签（并集去重后整体替换）。
 * note-tags 的 POST 是「整体替换」语义，故批量「打标签」需先读后并，绝不覆盖已有标签。
 */
export async function addTagsToNote(id: string, addTags: string[]): Promise<void> {
  const clean = Array.from(
    new Set(addTags.map((t) => t.trim().replace(/^#/, '')).filter(Boolean))
  );
  if (clean.length === 0) return;
  const current = await getNoteTags(id);
  const merged = Array.from(new Set([...current, ...clean]));
  // 与现有标签完全一致则无需写（少一次请求）。
  if (
    merged.length === current.length &&
    [...merged].sort().join(' ') === [...current].sort().join(' ')
  ) {
    return;
  }
  const res = await apiFetch('/api/library/note-tags', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ noteId: id, tags: merged }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `标签保存失败（${res.status}）`);
  }
}

/** 把逗号/顿号/空白分隔的标签串解析为去重数组（去掉前导 #）。与 RecentNoteEditor 同口径。 */
export function parseTagsInput(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[,，、\s]+/)
        .map((t) => t.trim().replace(/^#/, ''))
        .filter(Boolean)
    )
  );
}
