import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSignedUrl, OssConfigMissingError, AUDIO_PREFIX } from '@/lib/storage/oss';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/audio/url?key=audio/{userId}/...  —— 取音频播放签名 URL（去 Supabase 改造 · Phase C）
 *
 * 取代浏览器端 supabase.storage.from('audio').createSignedUrl(path, 3600)：
 * 客户端（NoteAudio / NoteSource）传对象 key，服务端校验 key 归属当前用户后返回 OSS 签名 URL。
 *
 * 授权（取代旧 RLS）：key 形如 `audio/{userId}/...`，要求其 userId 段 === getCurrentUser().id，
 * 否则 403，防止越权拉别人的音频。
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

  // 校验 key 归属：必须是 `audio/{userId}/...` 且 userId 段等于当前用户。
  const segments = key.split('/');
  if (segments[0] !== AUDIO_PREFIX || segments[1] !== user.id || segments.length < 3) {
    return NextResponse.json({ error: '无权访问该音频' }, { status: 403 });
  }

  try {
    const url = await getSignedUrl(key);
    return NextResponse.json({ url });
  } catch (err) {
    if (err instanceof OssConfigMissingError) {
      console.error('[audio/url] OSS 未配置：', err.message);
      return NextResponse.json({ error: '存储未配置，音频暂不可用' }, { status: 503 });
    }
    console.error('[audio/url] 取签名 URL 失败：', err);
    return NextResponse.json({ error: '取音频地址失败' }, { status: 500 });
  }
}
