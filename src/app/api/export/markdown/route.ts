import { and, asc, eq, isNull } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import {
  concepts as conceptsTable,
  noteConcepts,
  notes as notesTable,
} from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/**
 * GET /api/export/markdown —— 把当前用户的知识库导出为一份 Markdown
 *
 * 响应：Content-Type: text/markdown; charset=utf-8（前端触发下载）。
 * 组织方式：领域（domain）→ 主题（topic）→ 概念（name + summary）→ 其下原始记录正文（rawContent）。
 *   - 未填 domain/topic 的概念归到「未分类」（与知识库页 UNCATEGORIZED 口径一致）。
 *   - 原始记录排除软删（deleted_at is null）；记录正文取 rawContent，缺则回退 transcript / url。
 *
 * 鉴权 getCurrentUser()，授权严格按当前 userId 过滤——只导出自己的知识库。
 * 个人库数据量小，一次取全量在内存里按 领域/主题/概念 聚合（与 /library 页同策略）。
 */

const UNCATEGORIZED = '未分类';

interface ExportNote {
  rawContent: string | null;
  transcript: string | null;
  url: string | null;
  createdAt: string;
}

/** 概念正文落地：rawContent 优先，回退 transcript / url；都空则 null。 */
function noteBody(n: ExportNote): string | null {
  const body = (n.rawContent ?? n.transcript ?? n.url ?? '').trim();
  return body || null;
}

function isoOf(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    // 导出是浏览器直接打开/下载的端点；未登录用 401 文本（前端按钮仅登录态可见）。
    return new Response('未登录', { status: 401 });
  }

  const db = getDb();

  // 概念本体 + 该概念的关联记录（排除软删），并行取。
  const [conceptRows, ncRows] = await Promise.all([
    db
      .select({
        id: conceptsTable.id,
        name: conceptsTable.name,
        summary: conceptsTable.summary,
        domain: conceptsTable.domain,
        topic: conceptsTable.topic,
      })
      .from(conceptsTable)
      .where(eq(conceptsTable.userId, user.id))
      .orderBy(asc(conceptsTable.domain), asc(conceptsTable.topic), asc(conceptsTable.name)),
    db
      .select({
        conceptId: noteConcepts.conceptId,
        rawContent: notesTable.rawContent,
        transcript: notesTable.transcript,
        url: notesTable.url,
        createdAt: notesTable.createdAt,
      })
      .from(noteConcepts)
      .innerJoin(notesTable, eq(notesTable.id, noteConcepts.noteId))
      .innerJoin(conceptsTable, eq(conceptsTable.id, noteConcepts.conceptId))
      .where(and(eq(conceptsTable.userId, user.id), isNull(notesTable.deletedAt))),
  ]);

  // conceptId → 关联记录（按时间正序，导出按发生顺序读）。
  const notesByConcept = new Map<string, ExportNote[]>();
  for (const r of ncRows) {
    const list = notesByConcept.get(r.conceptId) ?? [];
    list.push({
      rawContent: r.rawContent,
      transcript: r.transcript,
      url: r.url,
      createdAt: isoOf(r.createdAt),
    });
    notesByConcept.set(r.conceptId, list);
  }
  for (const list of Array.from(notesByConcept.values())) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  // 领域 → 主题 → 概念 三层聚合（保持查询的 domain/topic/name 排序）。
  const domainOf = (c: { domain: string | null }) => c.domain?.trim() || UNCATEGORIZED;
  const topicOf = (c: { topic: string | null }) => c.topic?.trim() || UNCATEGORIZED;

  type ConceptRow = (typeof conceptRows)[number];
  const tree = new Map<string, Map<string, ConceptRow[]>>();
  for (const c of conceptRows) {
    const d = domainOf(c);
    const t = topicOf(c);
    if (!tree.has(d)) tree.set(d, new Map());
    const topics = tree.get(d)!;
    if (!topics.has(t)) topics.set(t, []);
    topics.get(t)!.push(c);
  }

  // ---- 拼装 Markdown ----
  const lines: string[] = [];
  const exportedAt = new Date().toISOString();
  lines.push('# 我的知识库');
  lines.push('');
  lines.push(`> 由小M导出 · ${exportedAt}`);
  lines.push(`> 概念 ${conceptRows.length} 个`);
  lines.push('');

  if (conceptRows.length === 0) {
    lines.push('知识库还是空的——先去记点东西，AI 整理后会自动归类。');
    lines.push('');
  } else {
    for (const [domain, topics] of Array.from(tree.entries())) {
      lines.push(`## ${domain}`);
      lines.push('');
      for (const [topic, list] of Array.from(topics.entries())) {
        lines.push(`### ${topic}`);
        lines.push('');
        for (const c of list) {
          lines.push(`#### ${c.name}`);
          lines.push('');
          const summary = (c.summary ?? '').trim();
          if (summary) {
            lines.push(summary);
            lines.push('');
          }
          const relatedNotes = (notesByConcept.get(c.id) ?? [])
            .map(noteBody)
            .filter((b): b is string => b !== null);
          if (relatedNotes.length > 0) {
            lines.push('**原始记录**');
            lines.push('');
            for (const body of relatedNotes) {
              // 多行正文整体作为一个引用块，保持 Markdown 结构可读。
              for (const ln of body.split('\n')) {
                lines.push(`> ${ln}`);
              }
              lines.push('');
            }
          }
        }
      }
    }
  }

  const markdown = lines.join('\n');
  const filename = `xiaom-knowledge-${exportedAt.slice(0, 10)}.md`;

  return new Response(markdown, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
