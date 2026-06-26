/**
 * 标签管理纯逻辑（V32 标签管理：改名 / 合并 / 删除）。
 *
 * 把「合并去重」「改名→是否撞同名合并」「多标签合并目标判定」等**与数据库无关**的决策
 * 抽成纯函数，便于单测（scripts/test-tags.ts）。API 路由负责事务执行；本模块只算「该做什么」。
 *
 * 关键约束（与 schema 对齐）：
 *   - tags 表 (user_id, name) 唯一（tags_user_id_name_key）：同一用户不能有两个同名标签。
 *   - note_tags 主键 (note_id, tag_id)：同一记录同一标签不能重复 → 合并/改名重指时必须去重
 *     （重指后若目标标签已挂同一记录，应 ON CONFLICT DO NOTHING，避免主键冲突）。
 *
 * 归一化口径：与单条标签编辑（NoteTagEditor / note-tags 路由）一致——去首尾空白、去前导 #、
 *   折叠内部连续空白为单个空格。**不改大小写**（标签大小写敏感，"AI" 与 "ai" 视为不同名，
 *   与 tags 的唯一索引按原文比较一致）。
 */

/** 单条标签最大长度（与库内标签输入上限同口径，避免超长脏名）。 */
export const MAX_TAG_LENGTH = 50;

/**
 * 归一化标签名：去首尾空白 + 去前导 #（可多个）+ 折叠内部连续空白为单空格。
 * 返回归一化后的字符串（可能为空串，表示非法/空名，调用方据此拒绝）。
 */
export function normalizeTagName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .trim()
    .replace(/^#+/, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, MAX_TAG_LENGTH)
    .trim();
}

/** 校验归一化后的标签名是否合法（非空且不超长）。 */
export function isValidTagName(name: string): boolean {
  return name.length > 0 && name.length <= MAX_TAG_LENGTH;
}

/**
 * 对一组标签 id 去重并剔除空白/无效项，保持首次出现顺序。
 * 用于合并入参 sourceTagIds 的清洗。
 */
export function dedupeIds(ids: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    if (typeof raw !== 'string') continue;
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export interface RenamePlan {
  /** 归一化后的目标名（合法时非空）。 */
  name: string;
  /**
   * 操作类型：
   *   - 'noop'   ：新名与原名相同（归一化后），无需任何写入。
   *   - 'rename' ：新名不撞已有标签，直接改 tags.name。
   *   - 'merge'  ：新名命中**另一个**已存在标签 → 把本标签 note_tags 重指到那个标签、去重、删本标签。
   */
  action: 'noop' | 'rename' | 'merge';
  /** action='merge' 时的目标标签 id（已存在的同名标签）；否则为 null。 */
  mergeTargetId: string | null;
}

export interface ExistingTag {
  id: string;
  name: string;
}

/**
 * 规划「改名」：给定源标签当前名、目标新名、以及该用户现有标签清单，
 * 判定应执行 noop / 纯改名 / 改名即合并。
 *
 * @param sourceId   被改名的标签 id（必须存在于 existing 中，调用方已校验归属）。
 * @param rawNewName 用户输入的新名（未归一化）。
 * @param existing   该用户全部标签 [{id,name}]（含源标签自身）。
 * @returns RenamePlan；name 为空表示新名非法（调用方回 400）。
 */
export function planTagRename(
  sourceId: string,
  rawNewName: string,
  existing: readonly ExistingTag[]
): RenamePlan {
  const name = normalizeTagName(rawNewName);
  if (!isValidTagName(name)) {
    return { name: '', action: 'noop', mergeTargetId: null };
  }

  const source = existing.find((t) => t.id === sourceId);
  // 源不存在交由路由的归属校验拦截；这里保守返回 noop。
  if (!source) {
    return { name, action: 'noop', mergeTargetId: null };
  }

  // 与原名完全一致（归一化后）→ 无需写入。
  if (source.name === name) {
    return { name, action: 'noop', mergeTargetId: null };
  }

  // 是否撞到**另一个**标签的名字（排除自身）。tags(user_id,name) 唯一，至多命中一个。
  const collision = existing.find((t) => t.id !== sourceId && t.name === name);
  if (collision) {
    return { name, action: 'merge', mergeTargetId: collision.id };
  }
  return { name, action: 'rename', mergeTargetId: null };
}

export interface MergePlan {
  /** 是否可执行（false 时 reason 给出原因）。 */
  ok: boolean;
  /** 目标标签 id（保留项）。 */
  targetId: string;
  /** 实际需要并入并删除的源标签 id（已去重、已剔除目标自身、已剔除非本人）。 */
  sourceIds: string[];
  /** ok=false 时的失败原因码。 */
  reason?: 'no-target' | 'target-not-owned' | 'no-source';
}

/**
 * 规划「多标签合并」：把若干源标签并入一个目标标签。
 *
 *   - 目标必须存在且归属本人（在 ownedIds 内）。
 *   - 源集合去重、剔除目标自身、剔除不归属本人的 id；剩余即真正要并删的源。
 *   - 若清洗后无任何源（例如只选了目标自己，或源都非法）→ ok=false reason='no-source'。
 *
 * @param rawSourceIds 用户选择的源标签 id（可能含目标自身 / 重复 / 非法）。
 * @param targetId     目标标签 id。
 * @param ownedIds     当前用户拥有的标签 id 集合（用于归属过滤）。
 */
export function planTagMerge(
  rawSourceIds: readonly unknown[],
  targetId: unknown,
  ownedIds: ReadonlySet<string>
): MergePlan {
  const target = typeof targetId === 'string' ? targetId.trim() : '';
  if (!target) {
    return { ok: false, targetId: '', sourceIds: [], reason: 'no-target' };
  }
  if (!ownedIds.has(target)) {
    return { ok: false, targetId: target, sourceIds: [], reason: 'target-not-owned' };
  }

  const sourceIds = dedupeIds(rawSourceIds).filter(
    (id) => id !== target && ownedIds.has(id)
  );
  if (sourceIds.length === 0) {
    return { ok: false, targetId: target, sourceIds: [], reason: 'no-source' };
  }
  return { ok: true, targetId: target, sourceIds };
}
