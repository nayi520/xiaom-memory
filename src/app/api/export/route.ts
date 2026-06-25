import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import {
  concepts as conceptsTable,
  noteConcepts,
  notes as notesTable,
  noteTags,
  tags as tagsTable,
} from '@/lib/db/schema';
import { enforceAiRateLimit } from '@/lib/ratelimit';
import { noteToMarkdown, type ExportNoteInput } from '@/features/export';

export const dynamic = 'force-dynamic';

/**
 * GET /api/export?format=json|md —— 知识库**整体导出**（V29 导出与分享 · 以记录为中心）
 *
 * 与既有 /api/export/all（结构化全量真备份，含卡片/复习/关联/设置）、/api/export/markdown
 * （按 领域›主题›概念 树）**互补**：本端点以**记录**为中心，给「可读 / 可携带 / 可再导入」的轻量导出。
 *   - format=json：{ exportedAt, notes:[...], concepts:[...], tags:[...] }，**仅活动记录**（排除回收站）。
 *   - format=md  ：把所有活动记录按时间倒序、每条用 noteToMarkdown + 分隔线拼成一篇可读 Markdown。
 *
 * 鉴权 getCurrentUser()；授权**严格按 userId 过滤 + 排除 deleted_at**，绝不混入他人/已删数据：
 *   - notes / concepts / tags 带 user_id 列 → 直接 eq 过滤；
 *   - note_tags / note_concepts 无 user_id 列 → 经本人记录 id 集合二次过滤。
 * 限流：按 userId 走 export 档（lib/ratelimit，低频），超限回 429（导出较重，防被刷）。
 *
 * 隐私：JSON 里 media_path 仅给对象 key（不现签公网地址）；Markdown 里语音/图片只注明「(附件)」不外链。
 * 个人库数据量小，一次取全量在内存里组装（与既有导出端点同策略）。
 */

const VALID_FORMATS = new Set(['json', 'md']);

function isoOf(v: Date | string | null): string | null {
  if (v === null) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    // 浏览器直接下载的端点；未登录用 401 文本（前端按钮仅登录态可见）。
    return new Response('未登录', { status: 401 });
  }

  // 成本/滥用闸：整库导出全量取数较重，按 userId 低频限流（确认登录后、产生 DB 负载前拦）。
  const rl = enforceAiRateLimit(user.id, 'export');
  if (!rl.ok) {
    return new Response('导出过于频繁，请稍后再试', {
      status: 429,
      headers: { 'Retry-After': String(rl.retryAfter) },
    });
  }

  const url = new URL(request.url);
  const format = (url.searchParams.get('format') ?? 'json').toLowerCase();
  if (!VALID_FORMATS.has(format)) {
    return new Response('format 仅支持 json 或 md', { status: 400 });
  }

  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  // —— 活动记录（排除回收站），按创建时间正序取，拼装时按需反转 —— //
  const noteRows = await db
    .select({
      id: notesTable.id,
      type: notesTable.type,
      raw_content: notesTable.rawContent,
      transcript: notesTable.transcript,
      url: notesTable.url,
      media_path: notesTable.mediaPath,
      why_important: notesTable.whyImportant,
      summary: notesTable.summary,
      status: notesTable.status,
      created_at: notesTable.createdAt,
    })
    .from(notesTable)
    .where(and(eq(notesTable.userId, user.id), isNull(notesTable.deletedAt)))
    .orderBy(asc(notesTable.createdAt));

  // ---- format=md：每条用 noteToMarkdown（降为二级标题），时间倒序，分隔线拼接 ----
  if (format === 'md') {
    const head = [
      '# 我的知识库',
      '',
      `> 由小M导出 · ${new Date().toISOString()}`,
      `> 记录 ${noteRows.length} 条`,
      '',
    ];
    if (noteRows.length === 0) {
      head.push('知识库还是空的——先去记点东西吧。', '');
    }

    // 时间倒序（新记录在前）。每条降为 ## 标题，让文档有「库 > 记录」层级。
    const blocks = noteRows
      .slice()
      .reverse()
      .map((n) =>
        noteToMarkdown(toNoteInput(n), { headingLevel: 2, includeTranscript: true })
      );

    // 记录之间用水平分隔线，视觉清晰、也便于再切分。
    const markdown = head.join('\n') + blocks.join('\n\n---\n\n');
    const filename = `xiaom-export-${today}.md`;

    return new Response(markdown.trim() + '\n', {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  // ---- format=json：结构化全量（活动记录 + 概念 + 标签）----
  const noteIds = noteRows.map((n) => n.id);

  const [conceptRows, tagRows] = await Promise.all([
    db
      .select({
        id: conceptsTable.id,
        name: conceptsTable.name,
        summary: conceptsTable.summary,
        domain: conceptsTable.domain,
        topic: conceptsTable.topic,
        created_at: conceptsTable.createdAt,
      })
      .from(conceptsTable)
      .where(eq(conceptsTable.userId, user.id))
      .orderBy(asc(conceptsTable.createdAt)),
    db
      .select({ id: tagsTable.id, name: tagsTable.name })
      .from(tagsTable)
      .where(eq(tagsTable.userId, user.id))
      .orderBy(asc(tagsTable.name)),
  ]);

  // 关联表无 user_id 列 → 经本人活动记录 id 集合二次过滤（空集合短路给空数组）。
  const [ntRows, ncRows] = await Promise.all([
    noteIds.length > 0
      ? db
          .select({ note_id: noteTags.noteId, tag_id: noteTags.tagId })
          .from(noteTags)
          .where(inArray(noteTags.noteId, noteIds))
      : Promise.resolve([] as Array<{ note_id: string; tag_id: string }>),
    noteIds.length > 0
      ? db
          .select({ note_id: noteConcepts.noteId, concept_id: noteConcepts.conceptId })
          .from(noteConcepts)
          .where(inArray(noteConcepts.noteId, noteIds))
      : Promise.resolve([] as Array<{ note_id: string; concept_id: string }>),
  ]);

  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    userId: user.id,
    counts: {
      notes: noteRows.length,
      concepts: conceptRows.length,
      tags: tagRows.length,
      noteTags: ntRows.length,
      noteConcepts: ncRows.length,
    },
    // media_path 仅给对象 key（私有 bucket，不现签公网地址——隐私）。
    notes: noteRows.map((n) => ({
      id: n.id,
      type: n.type,
      raw_content: n.raw_content,
      transcript: n.transcript,
      url: n.url,
      media_path: n.media_path,
      why_important: n.why_important,
      summary: n.summary,
      status: n.status,
      created_at: isoOf(n.created_at),
    })),
    concepts: conceptRows.map((c) => ({ ...c, created_at: isoOf(c.created_at) })),
    tags: tagRows,
    note_tags: ntRows,
    note_concepts: ncRows,
  };

  const body = JSON.stringify(payload, null, 2);
  const filename = `xiaom-export-${today}.json`;

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

/** DB 行（snake_case）→ noteToMarkdown 入参（camelCase + hasMedia 派生）。 */
function toNoteInput(n: {
  type: string;
  raw_content: string | null;
  transcript: string | null;
  url: string | null;
  media_path: string | null;
  why_important: string | null;
  summary: string | null;
  created_at: Date | string;
}): ExportNoteInput {
  return {
    type: n.type,
    rawContent: n.raw_content,
    transcript: n.transcript,
    url: n.url,
    whyImportant: n.why_important,
    summary: n.summary,
    hasMedia: Boolean(n.media_path),
    createdAt: n.created_at,
  };
}
