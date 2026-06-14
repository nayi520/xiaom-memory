import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { uploadAvatar, OssConfigMissingError } from '@/lib/storage/oss';
import { signAvatarUrl } from '@/lib/profile';

// 上传走 ali-oss（Node SDK），需 Node runtime；关闭 body 缓存。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** 允许的头像 MIME（与 oss.uploadAvatar 的扩展名映射一致）。 */
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
/** 头像大小上限：5MB。 */
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * POST /api/profile/avatar —— 上传头像到 OSS（用户资料）
 *
 * 仅接 multipart/form-data（字段 file）。校验：
 *   - 类型仅 image/png、image/jpeg、image/webp（其它 400）；
 *   - 大小 ≤ 5MB（超出 400）。
 * 照抄 /api/audio 的上传套路：getCurrentUser() 取 userId、读 file 成 Buffer、uploadAvatar() 落 OSS，
 * 把对象 key 写入 users.avatar_key（按 user.id 隔离），返回 { avatarUrl }（现签临时 URL）。
 * 未登录 401；缺 OSS 配置（OssConfigMissingError）优雅降级为 503。
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  // 仅接受 multipart/form-data 的 file 字段。
  let buf: Buffer;
  let contentType: string;
  const reqType = request.headers.get('content-type') ?? '';
  if (!reqType.includes('multipart/form-data')) {
    return NextResponse.json(
      { error: '请用 multipart/form-data 上传（字段 file）' },
      { status: 400 }
    );
  }
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: '缺少头像文件（字段 file）' }, { status: 400 });
    }
    contentType = (file.type || '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_TYPES.has(contentType)) {
      return NextResponse.json(
        { error: '头像仅支持 PNG / JPEG / WebP' },
        { status: 400 }
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: '头像不能超过 5MB' }, { status: 400 });
    }
    buf = Buffer.from(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: '读取上传内容失败' }, { status: 400 });
  }

  if (buf.length === 0) {
    return NextResponse.json({ error: '头像内容为空' }, { status: 400 });
  }
  // 二次防御：解码后字节数仍可能超限（Blob.size 不可信时兜底）。
  if (buf.length > MAX_BYTES) {
    return NextResponse.json({ error: '头像不能超过 5MB' }, { status: 400 });
  }

  let key: string;
  try {
    ({ key } = await uploadAvatar(user.id, buf, contentType));
  } catch (err) {
    if (err instanceof OssConfigMissingError) {
      console.error('[profile/avatar] OSS 未配置：', err.message);
      return NextResponse.json({ error: '存储未配置，头像上传暂不可用' }, { status: 503 });
    }
    console.error('[profile/avatar] 上传失败：', err);
    return NextResponse.json({ error: '头像上传失败' }, { status: 500 });
  }

  // 落库：把对象 key 写入 users.avatar_key（按 user.id 隔离）。
  try {
    await getDb().update(users).set({ avatarKey: key }).where(eq(users.id, user.id));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[profile/avatar] 写库失败：', err);
    return NextResponse.json({ error: `头像保存失败：${msg}` }, { status: 500 });
  }

  const avatarUrl = await signAvatarUrl(user.id, key);
  return NextResponse.json({ avatarUrl });
}
