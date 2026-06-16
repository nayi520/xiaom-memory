import { and, asc, eq, ne } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { cards as cardsTable, concepts as conceptsTable } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/**
 * GET /api/export/anki —— 把当前用户的复习卡片导出为 Anki 可导入的 CSV（V15）
 *
 * 响应：text/csv; charset=utf-8（前端触发下载）；附 UTF-8 BOM 便于 Excel/Anki 识别中文。
 * 列：问题, 答案, 概念（第三列为所属概念名，便于在 Anki 里按概念分组/打 tag）。
 *   - 顶部带 Anki import 头注释（#separator:Comma / #html:false / #columns），导入即识别分隔符与列。
 *   - 排除已暂停卡（status='suspended'，即埋葬），导出 active + graduated。
 *   - CSV 字段按 RFC4180 转义：含逗号/引号/换行的字段加双引号、内部引号翻倍。
 *
 * 鉴权 getCurrentUser()，授权严格按 concept→user_id 过滤——只导出自己的卡片。
 * 与既有 GET /api/export/markdown 并列，互不影响。
 */

/** RFC4180 CSV 字段转义：含 , " 换行 的字段整体加引号、内部引号翻倍。 */
function csvField(value: string): string {
  const v = value ?? '';
  if (/[",\r\n]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    // 导出是浏览器直接打开/下载的端点；未登录用 401 文本（前端按钮仅登录态可见）。
    return new Response('未登录', { status: 401 });
  }

  const db = getDb();

  // 卡片 + 所属概念名（经 concept join 按 user_id 过滤）；排除已暂停卡。
  const rows = await db
    .select({
      question: cardsTable.question,
      answer: cardsTable.answer,
      concept: conceptsTable.name,
    })
    .from(cardsTable)
    .innerJoin(conceptsTable, eq(conceptsTable.id, cardsTable.conceptId))
    .where(and(eq(conceptsTable.userId, user.id), ne(cardsTable.status, 'suspended')))
    .orderBy(asc(conceptsTable.name), asc(cardsTable.createdAt));

  const lines: string[] = [];
  // Anki import 头注释：声明分隔符、是否按 HTML 解析、列名（导入时自动对齐）。
  lines.push('#separator:Comma');
  lines.push('#html:false');
  lines.push('#columns:问题,答案,概念');
  for (const r of rows) {
    lines.push(
      [csvField(r.question), csvField(r.answer), csvField(r.concept)].join(',')
    );
  }

  // UTF-8 BOM：让 Excel/部分工具正确按 UTF-8 读中文（Anki 本身可不带，但带上更稳）。
  const body = '﻿' + lines.join('\r\n') + '\r\n';
  const filename = `xiaom-anki-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
