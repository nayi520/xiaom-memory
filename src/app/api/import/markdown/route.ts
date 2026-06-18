import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { notes } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/**
 * POST /api/import/markdown —— 导入 Markdown 为记录（V21 数据管理 & 掌控感）
 *
 * 入参（二选一）：
 *   - JSON：{ text: string, mode?: 'split' | 'single' }
 *   - multipart/form-data：file=<.md/.txt 文件>，可选 mode 字段
 * 出参（与 iOS 对齐的契约）：{ ok: true, created: int, skipped?: int }
 *
 * 切分规则（清晰、用户可在前端选择 mode）：
 *   - 'split'（默认）：按二级标题 `## ` 切分为多条记录；`## ` 之前的「前言」若有非空内容也单独成一条。
 *     每条把它自己的 `## 标题` 一并保留进正文（便于 AI 整理时识别主题）。
 *   - 'single'：整篇 Markdown 作为**一条**记录入库。
 *
 * 入库 = 走既有建记录逻辑（与 /api/onboarding/sample 同构）：type='text'、status='inbox'，
 *   因此能被既有 AI 流水线正常整理、在最近记录/时间线展示、用既有删除流程删除。
 *   空白段（仅空行/标题无正文）跳过并计入 skipped，避免产生空记录。
 *
 * 鉴权 getCurrentUser()；授权应用层——显式按 user.id 落库，只写入自己的记录。
 */

/** 单条记录正文上限（字符）：与捕获正文同量级，过长截断以防异常超大段落。 */
const MAX_NOTE_CHARS = 20_000;
/** 单次导入最多落库条数：防止一份超大文档生成海量记录拖垮后续 AI 整理 / 库容。 */
const MAX_NOTES_PER_IMPORT = 500;

type Mode = 'split' | 'single';

/**
 * 把整篇 Markdown 按二级标题 `## ` 切分为若干「块」。
 *   - 行首（允许前导空白）匹配 `## ` 视为新块起点（排除 `###`+ 更深层级）。
 *   - `## ` 之前的前言若非空，作为第一块（无标题正文）。
 *   - 每块保留它自己的 `## 标题` 行（连同其下正文），便于 AI 整理识别主题。
 */
function splitByH2(md: string): string[] {
  const lines = md.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  const isH2 = (line: string) => /^\s{0,3}##\s+\S/.test(line) && !/^\s{0,3}###/.test(line);

  for (const line of lines) {
    if (isH2(line)) {
      // 遇到新二级标题：先收束上一块（前言或上一个 ## 段）。
      if (current.length > 0) blocks.push(current.join('\n'));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current.join('\n'));
  return blocks;
}

/** 把一段文本整理为入库正文：去首尾空白、截断到上限；空白返回 null（跳过）。 */
function toBody(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_NOTE_CHARS ? trimmed.slice(0, MAX_NOTE_CHARS) : trimmed;
}

function normalizeMode(raw: unknown): Mode {
  return raw === 'single' ? 'single' : 'split';
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  // —— 解析入参：JSON 或 multipart —— //
  let text = '';
  let mode: Mode = 'split';

  const contentType = request.headers.get('content-type') ?? '';
  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      if (file instanceof File) {
        text = await file.text();
      } else if (typeof form.get('text') === 'string') {
        text = String(form.get('text'));
      }
      mode = normalizeMode(form.get('mode'));
    } else {
      const body = (await request.json()) as { text?: unknown; mode?: unknown };
      if (typeof body.text === 'string') text = body.text;
      mode = normalizeMode(body.mode);
    }
  } catch {
    return NextResponse.json({ error: '请求体解析失败（需 JSON 或 multipart）' }, { status: 400 });
  }

  if (!text.trim()) {
    return NextResponse.json({ error: '导入内容为空' }, { status: 400 });
  }

  // —— 切分为待入库正文 —— //
  const rawBlocks = mode === 'single' ? [text] : splitByH2(text);
  const bodies: string[] = [];
  let skipped = 0;
  for (const block of rawBlocks) {
    const body = toBody(block);
    if (body) bodies.push(body);
    else skipped += 1;
  }

  if (bodies.length === 0) {
    // 全是空白/标题无正文：没有可入库内容。
    return NextResponse.json({ ok: true, created: 0, skipped });
  }
  if (bodies.length > MAX_NOTES_PER_IMPORT) {
    return NextResponse.json(
      {
        error: `单次最多导入 ${MAX_NOTES_PER_IMPORT} 条（当前会切出 ${bodies.length} 条）。请拆分文件，或改用「整篇为一条」。`,
      },
      { status: 400 }
    );
  }

  // —— 批量落库（与 onboarding/sample 同构：type='text'、status='inbox'，交由既有 AI 流水线整理）—— //
  try {
    const rows = await getDb()
      .insert(notes)
      .values(
        bodies.map((rawContent) => ({
          userId: user.id,
          type: 'text' as const,
          rawContent,
          status: 'inbox' as const,
        }))
      )
      .returning({ id: notes.id });
    return NextResponse.json({ ok: true, created: rows.length, skipped });
  } catch (err) {
    console.error('[import/markdown] 导入失败：', err);
    return NextResponse.json({ error: '导入失败' }, { status: 500 });
  }
}
