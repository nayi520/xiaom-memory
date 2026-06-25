/**
 * 单条记录 → 干净 Markdown（V29 导出与分享）—— 纯函数层（无 IO、无 React）
 *
 * 用途：
 *   - 记录详情页「复制为 Markdown / 分享」（features/export/NoteExportActions）。
 *   - 知识库整体导出 GET /api/export?format=md（每条用本函数 + 分隔拼成长文档）。
 *
 * 设计原则（与 iOS 对齐、可读优先）：
 *   - 输出是**自洽、可直接粘到群/笔记**的 Markdown：一级标题 + 元信息行 + 正文 +（可选）为什么重要 / 来源 / 原始转写。
 *   - 会议纪要 / 语音 P8 的 raw_content **本身已是结构化 Markdown**，正文段直接原样输出即可读。
 *   - 不外链任何私有对象：语音/图片附件只注明「(音频附件)」「(图片附件)」，绝不现签公网地址（隐私）。
 *   - 纯函数、可脱离 DB 单测（见 scripts/test-export.ts）。
 *
 * 不做的事：不渲染 HTML、不转义 Markdown（raw_content 已是 MD，逐字保留），仅做结构拼装与空白整理。
 */

/** 记录类型 → 中文标签（与 ui 的 NOTE_TYPE_LABELS 同口径，避免本层依赖 React 组件）。 */
const TYPE_LABELS: Record<string, string> = {
  text: '文本',
  voice: '语音',
  link: '链接',
  image: '图片',
};

/** 记录类型 → 兜底标题（summary / 正文 都缺时用）。 */
const TYPE_TITLE_FALLBACK: Record<string, string> = {
  text: '文本记录',
  voice: '语音记录',
  link: '链接记录',
  image: '图片记录',
};

/** noteToMarkdown 接受的最小记录形态（调用方从 notes 取这几列即可；字段可选/可空，缺则跳过）。 */
export interface ExportNoteInput {
  type: string;
  /** 正文（已是 Markdown：文本原文 / 会议纪要 / 语音 AI 整理稿）。 */
  rawContent?: string | null;
  /** 原始转写（语音/会议；与 rawContent 不同则作为「原始转写」折叠引用块附在末尾）。 */
  transcript?: string | null;
  /** 来源链接（链接记录 / 带 url 的记录）。 */
  url?: string | null;
  /** 为什么重要（用户在捕获时填写）。 */
  whyImportant?: string | null;
  /** AI 摘要（可作标题来源；正文段不重复展示）。 */
  summary?: string | null;
  /** 是否有媒体附件（media_path 存在即可，不需传具体路径——隐私上只注明附件类型）。 */
  hasMedia?: boolean | null;
  /** 创建时间（Date 或 ISO 字符串；用于元信息行与默认标题日期兜底）。 */
  createdAt?: Date | string | null;
}

export interface NoteToMarkdownOptions {
  /**
   * 是否在末尾附「原始转写」折叠引用块（仅当 transcript 与正文不同）。默认 true。
   * 整库导出时可关掉以控制体积（md 导出走默认 true，保真）。
   */
  includeTranscript?: boolean;
  /**
   * 标题级别（# 的个数）。默认 1（单条分享/复制用一级标题）。
   * 整库导出把每条降为二级（## ），让文档有「库 > 记录」的层级。
   */
  headingLevel?: number;
}

/** 折叠首尾空白；把 3 个以上连续换行压成 2 个（段落间距规整，避免正文里的大块空行）。 */
function tidy(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function isoOf(v: Date | string | null | undefined): string | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  return String(v);
}

/** 'YYYY-MM-DD'（取 ISO 前 10 位；无效/缺失返回空串）。 */
function dateOnly(v: Date | string | null | undefined): string {
  const iso = isoOf(v);
  return iso ? iso.slice(0, 10) : '';
}

/**
 * 记录标题：summary 首句优先 → 正文首个非空片段 → 「类型 · 日期」兜底。
 * 折叠内部空白并截断到 max（默认 80），保证标题是单行短句。
 */
export function deriveNoteTitle(note: ExportNoteInput, max = 80): string {
  // 1) summary 首句（按中英文句末标点 / 换行切，取第一段）。
  const summary = (note.summary ?? '').trim();
  if (summary) {
    const firstSentence = summary.split(/(?<=[。！？!?\n])/)[0] ?? summary;
    const cleaned = firstSentence.replace(/\s+/g, ' ').trim();
    if (cleaned) return truncate(cleaned, max);
  }
  // 2) 正文首个非空行（去掉行首的 Markdown 标题/列表标记，让标题更干净）。
  const body = (note.rawContent ?? note.transcript ?? '').trim();
  if (body) {
    const firstLine = body
      .split('\n')
      .map((l) => l.replace(/^#{1,6}\s+/, '').replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, '').trim())
      .find((l) => l.length > 0);
    if (firstLine) return truncate(firstLine.replace(/\s+/g, ' ').trim(), max);
  }
  // 3) 类型 + 日期兜底。
  const label = TYPE_TITLE_FALLBACK[note.type] ?? '记录';
  const d = dateOnly(note.createdAt);
  return d ? `${label} · ${d}` : label;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * 把一条记录组织成干净 Markdown。
 *
 * 结构：
 *   # 标题
 *   > 类型 · 日期（元信息行，灰字引用）
 *
 *   正文（raw_content，已是 Markdown；语音缺正文时回退 transcript）
 *
 *   > 💡 为什么重要：…        （若有 whyImportant）
 *
 *   来源：<url>               （若有 url）
 *
 *   (音频附件) / (图片附件)    （若 hasMedia，注明而非外链——隐私）
 *
 *   <details>原始转写 …</details>  → 实为「**原始转写**」+ 引用块（若 transcript 与正文不同且 includeTranscript）
 *
 * @returns 末尾不带多余换行的 Markdown 字符串。
 */
export function noteToMarkdown(
  note: ExportNoteInput,
  options: NoteToMarkdownOptions = {}
): string {
  const includeTranscript = options.includeTranscript ?? true;
  const level = Math.min(6, Math.max(1, options.headingLevel ?? 1));
  const hashes = '#'.repeat(level);

  const lines: string[] = [];

  // —— 标题 + 元信息行 —— //
  lines.push(`${hashes} ${deriveNoteTitle(note)}`);
  const metaParts = [TYPE_LABELS[note.type] ?? note.type];
  const date = dateOnly(note.createdAt);
  if (date) metaParts.push(date);
  lines.push('');
  lines.push(`> ${metaParts.join(' · ')}`);
  lines.push('');

  // —— 正文（raw_content 优先；语音/会议缺正文时回退 transcript）—— //
  const body = tidy(note.rawContent ?? '') || tidy(note.transcript ?? '');
  if (body) {
    lines.push(body);
    lines.push('');
  }

  // —— 为什么重要 —— //
  const why = (note.whyImportant ?? '').trim();
  if (why) {
    // 多行也整体作引用块，保持「为什么重要」可视区分。
    const whyLines = tidy(why).split('\n');
    lines.push(`> 💡 **为什么重要**：${whyLines[0]}`);
    for (const ln of whyLines.slice(1)) lines.push(`> ${ln}`);
    lines.push('');
  }

  // —— 来源链接 —— //
  const url = (note.url ?? '').trim();
  if (url) {
    lines.push(`来源：${url}`);
    lines.push('');
  }

  // —— 媒体附件：只注明类型，绝不外链私有对象（隐私）。 —— //
  if (note.hasMedia) {
    if (note.type === 'voice') lines.push('（音频附件）');
    else if (note.type === 'image') lines.push('（图片附件）');
    else lines.push('（附件）');
    lines.push('');
  }

  // —— 原始转写折叠区：仅当 transcript 与正文不同（即正文是 AI 整理稿）才附，避免重复两遍。 —— //
  if (includeTranscript) {
    const transcript = tidy(note.transcript ?? '');
    if (transcript && transcript !== body) {
      lines.push('**原始转写**');
      lines.push('');
      for (const ln of transcript.split('\n')) lines.push(`> ${ln}`);
      lines.push('');
    }
  }

  // 收尾：折叠多余空行、去尾随空白。
  return tidy(lines.join('\n'));
}
