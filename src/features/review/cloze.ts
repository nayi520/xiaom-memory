/**
 * cloze 填空卡 —— 纯渲染支持（V14，不改 schema、不改创建流程）
 *
 * 约定：若卡片 question 含 `{{答案}}` 语法，即视为填空卡：
 *   - 复习正面（未翻面）：把每段 `{{...}}` 显示为挖空占位 `[...]`。
 *   - 翻面后：显示完整文本（把 `{{...}}` 的花括号去掉，留内容）。
 * 纯字符串处理，便于单测；TTS 朗读也复用「去标记后的完整文本」。
 */

/** 匹配一段 `{{...}}`（非贪婪，允许内部除 `}}` 外任意字符）。全局匹配。 */
const CLOZE_RE = /\{\{(.+?)\}\}/g;

/** 该文本是否为填空卡（含至少一段 `{{...}}`）。 */
export function hasCloze(text: string | null | undefined): boolean {
  if (!text) return false;
  CLOZE_RE.lastIndex = 0;
  return CLOZE_RE.test(text);
}

/** 挖空占位串（正面显示），可按需调整观感。 */
const BLANK = '[...]';

/**
 * 正面渲染：把每段 `{{X}}` 替换为挖空占位 `[...]`。
 * 非填空卡（无 `{{...}}`）原样返回。
 */
export function clozeFront(text: string): string {
  return text.replace(CLOZE_RE, BLANK);
}

/**
 * 翻面渲染：去掉花括号标记，保留答案内容（`{{X}}` → `X`）。
 * 非填空卡原样返回。
 */
export function clozeFull(text: string): string {
  return text.replace(CLOZE_RE, '$1');
}
