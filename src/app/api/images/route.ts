import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { uploadImage, OssConfigMissingError } from '@/lib/storage/oss';
import { enforceAiRateLimit } from '@/lib/ratelimit';

// 上传走 ali-oss（Node SDK），需 Node runtime；图片可能较大 → 关闭 body 缓存、放宽时长。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** 允许的图片 MIME（与 oss.uploadImage 的扩展名映射一致）。 */
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * 图片上传大小硬上限：默认 10MB，可由 env MAX_IMAGE_BYTES 覆盖。
 * 上限防超大上传打爆带宽/存储/后续 OCR。
 */
const MAX_IMAGE_BYTES = (() => {
  const raw = process.env.MAX_IMAGE_BYTES;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 10 * 1024 * 1024;
})();

/**
 * POST /api/images —— 上传捕获图片到 OSS（V13 图片捕获）
 *
 * 照抄 /api/audio 的上传套路：客户端把图片 POST 到这里，服务端 getCurrentUser() 取 userId、
 * 读 body 成 Buffer、调用 uploadImage() 落 OSS，返回对象 key。
 * 该 key（形如 `images/{userId}/{uuid}.<ext>`）即 notes.media_path，客户端拿到后走 /api/notes 建 image 记录。
 *
 * 接收两种 body：
 *   - multipart/form-data（字段名 `file`）—— 标准表单/拖拽/粘贴上传
 *   - 原始二进制（Content-Type 即图片 MIME，如 image/png）—— 直接 PUT Blob
 * 类型仅 image/png、image/jpeg、image/webp（其它 400）；大小 ≤ 10MB（超出 413）。
 *
 * 未登录 401；缺 OSS 配置（OssConfigMissingError）优雅降级为 503，不在 import 期崩。
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  // 成本/滥用闸：上传按 userId 限流（突发防刷；OCR 成本由后续 /api/ocr 的配额承担）。
  const rl = enforceAiRateLimit(user.id, 'image');
  if (!rl.ok) {
    return NextResponse.json(
      { error: '操作过于频繁，请稍后再试', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    );
  }

  // 输入硬上限（预检）：Content-Length 若已超限，早拒，避免白读超大 body。
  const declaredLen = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredLen) && declaredLen > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: `图片不能超过 ${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)}MB` },
      { status: 413 }
    );
  }

  // 读 body 成 Buffer + 推断 contentType（兼容 multipart 与原始二进制两种上传方式）。
  let buf: Buffer;
  let contentType: string;
  const reqType = request.headers.get('content-type') ?? '';
  try {
    if (reqType.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof Blob)) {
        return NextResponse.json({ error: '缺少图片文件（字段 file）' }, { status: 400 });
      }
      buf = Buffer.from(await file.arrayBuffer());
      contentType = (file.type || '').split(';')[0].trim().toLowerCase();
    } else {
      const ab = await request.arrayBuffer();
      buf = Buffer.from(ab);
      contentType = reqType.split(';')[0].trim().toLowerCase();
    }
  } catch {
    return NextResponse.json({ error: '读取上传内容失败' }, { status: 400 });
  }

  if (!ALLOWED_TYPES.has(contentType)) {
    return NextResponse.json({ error: '图片仅支持 PNG / JPEG / WebP' }, { status: 400 });
  }
  if (buf.length === 0) {
    return NextResponse.json({ error: '图片内容为空' }, { status: 400 });
  }
  // 实际字节硬上限（Content-Length 可能缺失/不可信，以真实读到的为准）。
  if (buf.length > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: `图片不能超过 ${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)}MB` },
      { status: 413 }
    );
  }

  try {
    const { key } = await uploadImage(user.id, buf, contentType);
    return NextResponse.json({ key });
  } catch (err) {
    if (err instanceof OssConfigMissingError) {
      // 优雅降级：未配置 OSS 时返回可读信息，而非 500 堆栈。
      console.error('[images] OSS 未配置：', err.message);
      return NextResponse.json({ error: '存储未配置，图片上传暂不可用' }, { status: 503 });
    }
    console.error('[images] 上传失败：', err);
    return NextResponse.json({ error: '图片上传失败' }, { status: 500 });
  }
}
