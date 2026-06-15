/**
 * 知识图谱数据（V8）—— 复用于 JSON API（GET /api/library/graph）。
 *
 * 取当前用户的全部概念（节点）与 concept_links（边），在内存里组装为
 * 力导向图所需的 { nodes, links } 形态：
 *   - nodes：{ id, name, domain, cardCount }（domain 用于前端按领域着色；
 *            cardCount = 该概念关联的复习卡数量，可用于节点大小）。
 *   - links：{ source, target, relationType, reason }（source/target 为概念 id）。
 *
 * 授权严格按 concepts.user_id 过滤（原靠 RLS）。边两端都必须是本人现存概念
 * （concept_links 有外键级联，但合并/删除竞态下仍做一次集合校验，丢弃悬挂边、自链接）。
 *
 * 规模控制：节点数超过 NODE_LIMIT 时，按 cardCount 降序（再按创建时间）截断到上限，
 * 并仅保留两端都在截断集合内的边；truncated/totalNodes 供前端提示「已截断展示」。
 */

import { and, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Database } from '@/lib/db/client';
import {
  cards as cardsTable,
  concepts as conceptsTable,
  conceptLinks,
} from '@/lib/db/schema';

/** 单次图谱返回的最大节点数（超出按 cardCount 截断，前端提示聚合/上限）。 */
export const GRAPH_NODE_LIMIT = 300;

export interface GraphNode {
  id: string;
  name: string;
  domain: string | null;
  cardCount: number;
}
export interface GraphLink {
  source: string;
  target: string;
  relationType: string | null;
  reason: string | null;
}
export interface LibraryGraph {
  nodes: GraphNode[];
  links: GraphLink[];
  /** 是否因超过 GRAPH_NODE_LIMIT 而截断展示。 */
  truncated: boolean;
  /** 截断前的概念总数（前端提示用）。 */
  totalNodes: number;
}

interface ConceptRow {
  id: string;
  name: string;
  domain: string | null;
  created_at: Date | string;
}

/**
 * 取某用户的知识图谱（节点 = 概念，边 = concept_links）。
 * 概念为空时返回空图。节点超过 GRAPH_NODE_LIMIT 时截断（truncated=true）。
 */
export async function getLibraryGraph(
  db: Database,
  userId: string
): Promise<LibraryGraph> {
  // 概念本体（节点）+ 每概念卡片数，按 user_id 过滤。
  // links 经下方集合校验限定到本人概念，无需在 SQL 层 join concepts。
  const [conceptData, cardRows] = await Promise.all([
    db
      .select({
        id: conceptsTable.id,
        name: conceptsTable.name,
        domain: conceptsTable.domain,
        created_at: conceptsTable.createdAt,
      })
      .from(conceptsTable)
      .where(eq(conceptsTable.userId, userId)),
    db
      .select({ concept_id: cardsTable.conceptId })
      .from(cardsTable)
      .innerJoin(conceptsTable, eq(conceptsTable.id, cardsTable.conceptId))
      .where(eq(conceptsTable.userId, userId)),
  ]);

  const cardCount = new Map<string, number>();
  for (const row of cardRows) {
    cardCount.set(row.concept_id, (cardCount.get(row.concept_id) ?? 0) + 1);
  }

  // 全部节点（先组装，后按需截断）。
  let allNodes: GraphNode[] = (conceptData as ConceptRow[]).map((c) => ({
    id: c.id,
    name: c.name,
    domain: c.domain,
    cardCount: cardCount.get(c.id) ?? 0,
  }));
  const totalNodes = allNodes.length;

  // 规模控制：超上限按 cardCount 降序截断（卡多 = 更常复习，优先展示）。
  const truncated = totalNodes > GRAPH_NODE_LIMIT;
  if (truncated) {
    allNodes = [...allNodes]
      .sort((a, b) => b.cardCount - a.cardCount)
      .slice(0, GRAPH_NODE_LIMIT);
  }

  const nodeIds = new Set(allNodes.map((n) => n.id));
  if (nodeIds.size === 0) {
    return { nodes: [], links: [], truncated: false, totalNodes };
  }

  // 边：两端 join concepts 并按 user_id 过滤，确保只取本人概念之间的链接
  // （而非依赖外键级联的悬挂边）。返回后再用节点集合二次校验（截断/竞态）。
  const ca = alias(conceptsTable, 'ca');
  const cb = alias(conceptsTable, 'cb');
  const linkRows = await db
    .select({
      concept_a: conceptLinks.conceptA,
      concept_b: conceptLinks.conceptB,
      relation_type: conceptLinks.relationType,
      reason: conceptLinks.reason,
    })
    .from(conceptLinks)
    .innerJoin(ca, eq(ca.id, conceptLinks.conceptA))
    .innerJoin(cb, eq(cb.id, conceptLinks.conceptB))
    .where(and(eq(ca.userId, userId), eq(cb.userId, userId)));

  const links: GraphLink[] = [];
  for (const l of linkRows) {
    // 两端都须在节点集合内（截断时部分概念不在），且非自链接（防御性）。
    if (l.concept_a === l.concept_b) continue;
    if (!nodeIds.has(l.concept_a) || !nodeIds.has(l.concept_b)) continue;
    links.push({
      source: l.concept_a,
      target: l.concept_b,
      relationType: l.relation_type,
      reason: l.reason,
    });
  }

  return { nodes: allNodes, links, truncated, totalNodes };
}
