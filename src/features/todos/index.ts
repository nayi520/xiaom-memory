/**
 * 行动项中心聚合（V28）——把跨记录解析出的待办 + 完成状态合成 { open, done }。
 *
 * 纯函数层（无 IO）：取数（按 user_id 过滤、排除 deleted_at 的 notes + 命中的 todo_completions）
 * 由调用方（API 路由 / 服务端页）负责；这里只做「解析 raw_content → 叠加完成态 → 分组排序」。
 * 这样 API 与页面共用同一聚合逻辑，且可脱离 DB 单测。
 */

import { parseTodos } from './parse';

/** 聚合后单条行动项（跨记录，含来源信息，供列表渲染 + toggle 回填）。 */
export interface TodoItem {
  /** 来源记录 id（点击跳 /library/note/[id]）。 */
  noteId: string;
  /** 来源记录类型（text/voice/link/image；渲染类型图标）。 */
  noteType: string;
  /** 来源记录标题（summary → raw_content 首行 → 类型名兜底）。 */
  noteTitle: string;
  /** 待办正文（保留原始大小写/标点）。 */
  text: string;
  /** 归一化稳定键（与 todo_completions 对账；toggle 时回传）。 */
  itemKey: string;
  /** 来源记录创建时间（ISO 字符串；用于排序/展示）。 */
  createdAt: string;
}

/** 聚合返回：未完成 + 已完成两组。 */
export interface TodoLists {
  open: TodoItem[];
  done: TodoItem[];
}

/** 聚合的最小记录形态（调用方从 notes 取这几列即可）。 */
export interface TodoSourceNote {
  id: string;
  type: string;
  rawContent: string | null;
  summary: string | null;
  createdAt: Date | string;
}

/** 记录类型 → 中文兜底标题（与 ui 的 NOTE_TYPE_LABELS 同口径，避免本层依赖 React 组件）。 */
const TYPE_FALLBACK: Record<string, string> = {
  text: '文本记录',
  voice: '语音记录',
  link: '链接记录',
  image: '图片记录',
};

function isoOf(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

/** 记录标题：summary 优先，其次 raw_content 首个非空片段，最后类型名兜底；折叠空白并截断。 */
export function deriveNoteTitle(note: TodoSourceNote, max = 60): string {
  const candidate = (note.summary ?? '').trim() || (note.rawContent ?? '').trim();
  const cleaned = candidate.replace(/\s+/g, ' ').trim();
  if (!cleaned) return TYPE_FALLBACK[note.type] ?? '记录';
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}

/**
 * 聚合 { open, done }。
 *
 * @param notes      本人未删除、且 raw_content 含待办的候选记录（调用方已过滤 user_id / deleted_at）。
 * @param completedKeys  已完成集合：key = `${noteId}:${itemKey}`（命中即视为完成，覆盖源 Markdown 的 [x]）。
 *
 * 规则：
 * - 待办文本实时解析自 raw_content；完成态 = 源 Markdown `- [x]` **或** 命中 completedKeys。
 *   （命中 todo_completions 优先：用户在行动项中心勾掉的，即使源是 `- [ ]` 也算完成。）
 * - 同一记录内按 itemKey 去重（同文本多次出现只取首条），避免重复行。
 * - open 按记录时间倒序（新记录的待办在前）；done 按记录时间倒序。
 */
export function buildTodoLists(
  notes: TodoSourceNote[],
  completedKeys: Set<string>
): TodoLists {
  const open: TodoItem[] = [];
  const done: TodoItem[] = [];

  // 记录已按 createdAt 倒序传入；逐记录解析，记录内去重。
  for (const note of notes) {
    const parsed = parseTodos(note.rawContent);
    if (parsed.length === 0) continue;
    const title = deriveNoteTitle(note);
    const createdAt = isoOf(note.createdAt);
    const seen = new Set<string>();
    for (const todo of parsed) {
      if (seen.has(todo.itemKey)) continue;
      seen.add(todo.itemKey);
      const item: TodoItem = {
        noteId: note.id,
        noteType: note.type,
        noteTitle: title,
        text: todo.text,
        itemKey: todo.itemKey,
        createdAt,
      };
      const isDone = todo.checked || completedKeys.has(`${note.id}:${todo.itemKey}`);
      if (isDone) done.push(item);
      else open.push(item);
    }
  }

  return { open, done };
}
