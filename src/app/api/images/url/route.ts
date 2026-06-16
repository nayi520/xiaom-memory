import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSignedUrl, OssConfigMissingError, IMAGE_PREFIX } from '@/lib/storage/oss';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/images/url?key=images/{userId}/...  —— 取图片展示签名 URL（V13 图片捕获）
 *
 * 照抄 /api/audio/url：客户端（记录列表/详情）传对象 key，服务端校验 key 归属当前用户后返回 OSS 签名 URL。
 *
 * 授权（取代旧 RLS）：key 形如 `images/{userId}/...`，要求其 userId 段 === getCurrentUser().id，
 * 否则 403，防止越权拉别人的图片。
 *
 * 缺 OSS 配置时（OssConfigMissingError）返回 503，不在 import 期崩。
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key');
  if (!key) {
    return NextResponse.json({ error: '缺少 key' }, { status: 400 });
  }

  // 校验 key 归属：必须是 `images/{userId}/...` 且 userId 段等于当前用户。
  const segments = key.split('/');
  if (segments[0] !== IMAGE_PREFIX || segments[1] !== user.id || segments.length < 3) {
    return NextResponse.json({ error: '无权访问该图片' }, { status: 403 });
  }

  try {
    const url = await getSignedUrl(key);
    return NextResponse.json({ url });
  } catch (err) {
    if (err instanceof OssConfigMissingError) {
      console.error('[images/url] OSS 未配置：', err.message);
      return NextResponse.json({ error: '存储未配置，图片暂不可用' }, { status: 503 });
    }
    console.error('[images/url] 取签名 URL 失败：', err);
    return NextResponse.json({ error: '取图片地址失败' }, { status: 500 });
  }
}
