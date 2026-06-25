/**
 * 待办解析（V28 行动项中心）——从 note.raw_content 实时解析 Markdown 任务项。
 *
 * 背景：语音速记（P8）/ 会议记录（P8M）总结后，会在 raw_content 写出待办区块，形如
 *   ## ✅ 待办 / 行动项
 *   - [ ] 周五前给张三回邮件
 *   - [x] 确认预算
 * 这些待办散落各记录里。行动项中心把它们**实时**解析聚合（新待办自动出现，不冗余存储），
 * 只把「完成」状态持久化到 todo_completions（派生 + 叠加，不改 raw_content）。
 *
 * 本文件是**纯函数**（无 IO、无 DB、无 React），便于脱离环境单测（scripts/test-todos.ts）。
 *
 * 设计要点：
 * - 只认 GFM 任务清单语法的「行首」标记：`- [ ]`（未完成）/ `- [x]`（已完成）。
 *   容忍：前导空格 / Tab（嵌套缩进）、`*` 或 `+` 作为列表符、`[X]` 大写、`[ ]` 内多空格。
 * - **不**把普通列表项（`- 文本`，无 `[ ]`）当待办——那是「关键要点 / 决议」等非勾选内容。
 * - itemKey：对待办文本归一化（trim + 小写 + 折叠空白 + 去常见标点/emoji）后取 djb2 hash，
 *   作为 (note_id, item_key) 的稳定键。归一化让「确认预算。」与「确认预算」视为同一项，
 *   即便用户后续微调措辞也尽量保持完成态不丢；同一 note 内极少出现归一化后相同的两条待办。
 */

/** 一条解析出来的待办项（文本 + 是否已勾选）。 */
export interface ParsedTodo {
  /** 去掉 `- [ ]` 标记后的待办正文（已 trim，保留原始大小写/标点供展示）。 */
  text: string;
  /** 源 Markdown 是否标记为已完成（`- [x]` / `- [X]`）。 */
  checked: boolean;
  /** 归一化稳定键（同文本恒定；用于与 todo_completions 对账）。 */
  itemKey: string;
}

/**
 * 行首任务清单标记：
 *   ^[空白]*           允许任意前导空白（含嵌套缩进）
 *   [-*+]              列表符（- / * / +）
 *   [ \t]+             标记与方括号间至少一个空白
 *   \[[ \txX]\]        方括号内：空白(未完成) 或 x/X(已完成)；容忍内部空白
 *   [ \t]+            方括号与正文间至少一个空白
 *   (.*)$              正文（可空，空正文项将被丢弃）
 * 注意：`\[[ \txX]\]` 仅匹配单字符复选框（GFM 规范）；`[X ]` 这类多字符不视为任务项。
 */
const TASK_LINE = /^[ \t]*[-*+][ \t]+\[([ \txX])\][ \t]+(.*)$/;

/**
 * 解析 raw_content 中的所有 Markdown 任务项（未完成 + 已完成，按出现顺序）。
 *
 * @param rawContent note.raw_content（可空 / 空串 → 返回空数组）。
 * @returns 顺序保留的待办列表；每项含 text / checked / itemKey。
 */
export function parseTodos(rawContent: string | null | undefined): ParsedTodo[] {
  if (!rawContent) return [];
  const out: ParsedTodo[] = [];
  // 兼容 \r\n / \r 换行；逐行匹配行首任务标记。
  const lines = rawContent.split(/\r\n|\r|\n/);
  for (const line of lines) {
    const m = TASK_LINE.exec(line);
    if (!m) continue;
    const mark = m[1];
    const text = m[2].trim();
    // 空正文（`- [ ]` 后无内容）不算有效待办，丢弃。
    if (!text) continue;
    out.push({
      text,
      checked: mark === 'x' || mark === 'X',
      itemKey: todoItemKey(text),
    });
  }
  return out;
}

/**
 * 待办文本 → 稳定归一化键（djb2 hex）。
 *
 * 归一化：小写 → 折叠所有空白为单空格 → 去掉常见标点 / 项目符号 / emoji 变体选择符 → trim。
 * 这样「确认预算。」「确认 预算」「确认预算」会落到同一 key，完成态对小幅措辞改动更稳。
 * 对空白归一化后为空串的极端输入，回退用原文 hash（理论上 parseTodos 已挡掉空正文）。
 */
export function todoItemKey(text: string): string {
  const normalized = normalizeTodoText(text);
  return djb2Hex(normalized || text);
}

/**
 * 归一化（仅用于派生稳定 key，不用于展示）：小写后**只保留「实义」字符**
 * （ASCII 字母/数字 + 中日韩文字 + 假名），丢弃其余一切（标点 / 符号 / emoji / 全部空白）。
 *
 * 采用「allowlist 保留」而非「denylist 去除」，以避开 \p{…} Unicode 属性转义与 'u' flag
 *（项目 tsconfig 未显式设 target，'u' flag 会被 TS 编译期拒绝）。保留 emoji 等星平面字符无意义、
 * 不在 allowlist 内的码元会被一并去掉，正是所需。
 *
 * 去空白让「确认预算」「确认 预算」落到同一 key——中文不以空格分词，AI 输出偶发的空格差异
 * 不应让完成态丢失；对英文虽会把「call bob」与「callbob」视同，但作为同一记录内的完成对账键，
 * 这种碰撞极罕见且无害。
 */
// 保留集合：ASCII 字母数字 + CJK 统一表意文字(含扩展A) + 中日韩兼容/部首补充 + 平假名/片假名。
// 不含 'u' flag；范围足够覆盖中文与日文常用字，其余（标点/符号/emoji/空白）一律剔除。
const KEEP_CHARS = /[^0-9a-z぀-ヿ㐀-䶿一-鿿豈-﫿]+/g;

export function normalizeTodoText(text: string): string {
  return text.toLowerCase().replace(KEEP_CHARS, '');
}

/** djb2 字符串哈希 → 8 位十六进制（无符号）。稳定、零依赖、足够分散用于同 note 内对账。 */
function djb2Hex(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    // h * 33 + c，强制 32 位无符号回绕。
    h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
