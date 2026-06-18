import { asc, eq, inArray } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import {
  cards as cardsTable,
  conceptLinks,
  concepts as conceptsTable,
  noteConcepts,
  noteTags,
  notes as notesTable,
  profiles,
  reviews as reviewsTable,
  tags as tagsTable,
} from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/**
 * GET /api/export/all —— 当前用户**全部数据**的真备份（V21 数据管理 & 掌控感）
 *
 * 响应：application/json 附件（前端 fetch+blob 触发下载）。一份结构清晰、可读、可作真备份的 JSON。
 *
 * 形状（与 iOS 对齐的契约）：
 *   {
 *     version: 1,
 *     exportedAt: ISO,
 *     userId,                                   // 仅本人 id，便于核对归属
 *     counts: { notes, concepts, cards, tags, noteTags, noteConcepts, links, reviews },
 *     notes:        [{ id, type, raw_content, transcript, url, media_path, why_important, status, summary, deleted_at, created_at }],
 *     concepts:     [{ id, name, summary, domain, topic, created_at }],   // 不含 embedding 向量（体积大、可由内容重建）
 *     cards:        [{ id, concept_id, question, answer, fsrs_state, status, created_at }],
 *     tags:         [{ id, name }],
 *     note_tags:    [{ note_id, tag_id }],
 *     note_concepts:[{ note_id, concept_id }],
 *     links:        [{ concept_a, concept_b, relation_type, reason, created_at }],
 *     reviews:      [{ id, card_id, rating, reviewed_at }],
 *     settings:     { ... } | null,             // profiles.settings 原样
 *   }
 *
 * 鉴权 getCurrentUser()；授权**严格按 userId 过滤**，绝不混入他人数据：
 *   - notes / concepts / tags 直接带 user_id 列 → 直接 eq 过滤。
 *   - cards / reviews / links / note_concepts / note_tags 无 user_id 列 → 经其归属实体（概念 / 记录）
 *     的 id 集合二次过滤（cards/links/reviews 经概念；note_tags/note_concepts 经记录），确保只导自己的。
 *   - 软删记录一并导出（备份要完整，deleted_at 字段如实保留），与「导出 Markdown」只取活动记录不同。
 *
 * 个人库数据量小，分查后在内存里组装为一份 JSON（与 /api/export/markdown 同策略）。
 */

function isoOf(v: Date | string | null): string | null {
  if (v === null) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    // 浏览器直接下载的端点；未登录用 401 文本（前端按钮仅登录态可见）。
    return new Response('未登录', { status: 401 });
  }

  const db = getDb();

  // —— 第一波：带 user_id 列的实体，直接按本人过滤 —— //
  const [noteRows, conceptRows, tagRows, settingsRows] = await Promise.all([
    db
      .select({
        id: notesTable.id,
        type: notesTable.type,
        raw_content: notesTable.rawContent,
        transcript: notesTable.transcript,
        url: notesTable.url,
        media_path: notesTable.mediaPath,
        why_important: notesTable.whyImportant,
        status: notesTable.status,
        summary: notesTable.summary,
        deleted_at: notesTable.deletedAt,
        created_at: notesTable.createdAt,
      })
      .from(notesTable)
      .where(eq(notesTable.userId, user.id))
      .orderBy(asc(notesTable.createdAt)),
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
    db
      .select({ settings: profiles.settings })
      .from(profiles)
      .where(eq(profiles.id, user.id))
      .limit(1),
  ]);

  const noteIds = noteRows.map((n) => n.id);
  const conceptIds = conceptRows.map((c) => c.id);

  // —— 第二波：无 user_id 列的关联实体，经本人 id 集合二次过滤 —— //
  // 空集合时短路（inArray([]) 在部分驱动会生成无意义/错误 SQL），直接给空数组。
  const cardRowsP =
    conceptIds.length > 0
      ? db
          .select({
            id: cardsTable.id,
            concept_id: cardsTable.conceptId,
            question: cardsTable.question,
            answer: cardsTable.answer,
            fsrs_state: cardsTable.fsrsState,
            status: cardsTable.status,
            created_at: cardsTable.createdAt,
          })
          .from(cardsTable)
          .where(inArray(cardsTable.conceptId, conceptIds))
          .orderBy(asc(cardsTable.createdAt))
      : Promise.resolve([] as Array<{
          id: string;
          concept_id: string;
          question: string;
          answer: string;
          fsrs_state: unknown;
          status: string;
          created_at: Date | string;
        }>);

  const linkRowsP =
    conceptIds.length > 0
      ? db
          .select({
            concept_a: conceptLinks.conceptA,
            concept_b: conceptLinks.conceptB,
            relation_type: conceptLinks.relationType,
            reason: conceptLinks.reason,
            created_at: conceptLinks.createdAt,
          })
          .from(conceptLinks)
          // 两端都须是本人概念，避免越权混入（理论上 FK 已保证，这里再设双重保险）。
          .where(inArray(conceptLinks.conceptA, conceptIds))
          .orderBy(asc(conceptLinks.createdAt))
      : Promise.resolve([] as Array<{
          concept_a: string;
          concept_b: string;
          relation_type: string | null;
          reason: string | null;
          created_at: Date | string;
        }>);

  const ncRowsP =
    noteIds.length > 0
      ? db
          .select({
            note_id: noteConcepts.noteId,
            concept_id: noteConcepts.conceptId,
          })
          .from(noteConcepts)
          .where(inArray(noteConcepts.noteId, noteIds))
      : Promise.resolve([] as Array<{ note_id: string; concept_id: string }>);

  const ntRowsP =
    noteIds.length > 0
      ? db
          .select({ note_id: noteTags.noteId, tag_id: noteTags.tagId })
          .from(noteTags)
          .where(inArray(noteTags.noteId, noteIds))
      : Promise.resolve([] as Array<{ note_id: string; tag_id: string }>);

  const [cardRows, linkRows, ncRows, ntRows] = await Promise.all([
    cardRowsP,
    linkRowsP,
    ncRowsP,
    ntRowsP,
  ]);

  // reviews 经卡片归属（cards.id 集合）二次过滤——卡片已限定为本人概念之下。
  const cardIds = cardRows.map((c) => c.id);
  const reviewRows =
    cardIds.length > 0
      ? await db
          .select({
            id: reviewsTable.id,
            card_id: reviewsTable.cardId,
            rating: reviewsTable.rating,
            reviewed_at: reviewsTable.reviewedAt,
          })
          .from(reviewsTable)
          .where(inArray(reviewsTable.cardId, cardIds))
          .orderBy(asc(reviewsTable.reviewedAt))
      : [];

  // 进一步收紧 links：两端都必须落在本人概念集合内（防 conceptA 为本人但 conceptB 越权的边）。
  const conceptIdSet = new Set(conceptIds);
  const links = linkRows.filter(
    (l) => conceptIdSet.has(l.concept_a) && conceptIdSet.has(l.concept_b)
  );

  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    userId: user.id,
    counts: {
      notes: noteRows.length,
      concepts: conceptRows.length,
      cards: cardRows.length,
      tags: tagRows.length,
      noteTags: ntRows.length,
      noteConcepts: ncRows.length,
      links: links.length,
      reviews: reviewRows.length,
    },
    notes: noteRows.map((n) => ({
      ...n,
      deleted_at: isoOf(n.deleted_at),
      created_at: isoOf(n.created_at),
    })),
    concepts: conceptRows.map((c) => ({ ...c, created_at: isoOf(c.created_at) })),
    cards: cardRows.map((c) => ({ ...c, created_at: isoOf(c.created_at) })),
    tags: tagRows,
    note_tags: ntRows,
    note_concepts: ncRows,
    links: links.map((l) => ({ ...l, created_at: isoOf(l.created_at) })),
    reviews: reviewRows.map((r) => ({ ...r, reviewed_at: isoOf(r.reviewed_at) })),
    settings: settingsRows[0]?.settings ?? null,
  };

  // 缩进 2 空格：可读、便于人工核对，也方便日后导入解析。
  const body = JSON.stringify(payload, null, 2);
  const filename = `xiaom-backup-${payload.exportedAt.slice(0, 10)}.json`;

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
