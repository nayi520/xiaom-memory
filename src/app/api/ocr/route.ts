import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { notes } from '@/lib/db/schema';
import { getSignedUrl, OssConfigMissingError } from '@/lib/storage/oss';
import { ocrImageUrl, LlmKeyMissingError, LlmVisionError } from '@/lib/llm';
import { enforceAiRateLimit } from '@/lib/ratelimit';
import { consumeQuota } from '@/lib/quota';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// qwen-vl OCR 为同步请求（图文一次往返），通常几秒内；放宽到 120s 兜底大图/慢响应。
export const maxDuration = 120;

/**
 * POST /api/ocr  { noteId }  —— 图片转文字（V13 图片捕获 · qwen-vl 多模态）
 *
 * 形态对齐 /api/transcribe：取 note 对应图片的 OSS 签名 URL → qwen-vl OCR → 写回 transcript / raw_content。
 *   - 校验 noteId 是本人、type='image'、有 media_path，且 media_path 落在本人 images/ 前缀下（纵深防御）；
 *   - 接既有限流（ocr 档）+ 每日配额（kind=ocr，用既有 usage_counters 表）；
 *   - OCR 文本写回 raw_content（供搜索 + 进既有 AI 概念抽取管道）与 transcript；
 *   - 未配置 DASHSCOPE_API_KEY / OSS 或调用失败 → 优雅降级（图已存，OCR 待重试），不报 500。
 *
 * 返回契约（给 iOS 对齐）：{ ocr: boolean, text?: string, message?: string }
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  let noteId: string | undefined;
  try {
    ({ noteId } = await request.json());
  } catch {
    /* noop */
  }
  if (!noteId) {
    return NextResponse.json({ error: '缺少 noteId' }, { status: 400 });
  }

  const db = getDb();
  // 显式按 user_id 过滤（原靠 RLS）。
  const noteRows = await db
    .select({ id: notes.id, type: notes.type, media_path: notes.mediaPath })
    .from(notes)
    .where(and(eq(notes.id, noteId), eq(notes.userId, user.id)))
    .limit(1);
  const note = noteRows[0];
  if (!note || note.type !== 'image' || !note.media_path) {
    return NextResponse.json({ error: '记录不存在或非图片' }, { status: 404 });
  }
  // 纵深防御：只对本人 OSS 前缀的图片签名，杜绝越权 OCR 他人图片对象。
  if (!note.media_path.startsWith(`images/${user.id}/`)) {
    return NextResponse.json({ error: '记录不存在或非图片' }, { status: 404 });
  }

  // 成本/滥用闸：OCR（qwen-vl）按 userId 限流 + 每日配额。确认本人图片记录后、产生 AI 成本前拦。
  const rl = enforceAiRateLimit(user.id, 'ocr');
  if (!rl.ok) {
    return NextResponse.json(
      { error: '操作过于频繁，请稍后再试', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    );
  }
  const quota = await consumeQuota(user.id, 'ocr');
  if (!quota.ok) {
    return NextResponse.json(
      { error: '今日额度已用尽', kind: 'ocr', limit: quota.limit },
      { status: 429 }
    );
  }

  // 取给 qwen-vl 拉取图片用的签名 URL。OSS 未配置时优雅降级。
  let imageUrl: string;
  try {
    imageUrl = await getSignedUrl(note.media_path);
  } catch (err) {
    if (err instanceof OssConfigMissingError) {
      return NextResponse.json({
        ocr: false,
        message: 'OCR 待配置（存储未配置），图片已保存',
      });
    }
    console.error('[ocr] 取图片 URL 失败：', err);
    return NextResponse.json({ error: '图片地址生成失败' }, { status: 500 });
  }

  try {
    const { text } = await ocrImageUrl(imageUrl, { task: 'OCR' });

    // 纯图无字：不写空内容覆盖（保持图片记录可见，提示未识别到文字）。
    if (!text) {
      return NextResponse.json({
        ocr: false,
        message: '未在图片中识别到文字',
      });
    }

    try {
      // 写回 raw_content（进搜索 + AI 概念抽取管道）与 transcript（保留 OCR 原文）。
      await db
        .update(notes)
        .set({ transcript: text, rawContent: text })
        .where(and(eq(notes.id, noteId), eq(notes.userId, user.id)));
    } catch {
      return NextResponse.json({ error: 'OCR 结果保存失败' }, { status: 500 });
    }

    return NextResponse.json({ ocr: true, text });
  } catch (err) {
    if (err instanceof LlmKeyMissingError) {
      // 优雅降级：未配置 DASHSCOPE_API_KEY 时不报错，提示待配置。
      return NextResponse.json({
        ocr: false,
        message: 'OCR 待配置（未设置 DASHSCOPE_API_KEY），图片已保存',
      });
    }
    if (err instanceof LlmVisionError) {
      console.error('[ocr] qwen-vl 失败：', err.message);
      return NextResponse.json({
        ocr: false,
        message: 'OCR 失败，图片已保存（稍后可重试）',
      });
    }
    console.error('[ocr] error:', err);
    return NextResponse.json({
      ocr: false,
      message: 'OCR 失败，图片已保存（稍后可重试）',
    });
  }
}
