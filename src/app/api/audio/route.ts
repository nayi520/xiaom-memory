import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { uploadAudio, OssConfigMissingError } from '@/lib/storage/oss';
import { enforceAiRateLimit } from '@/lib/ratelimit';

// 上传走 ali-oss（Node SDK），需 Node runtime；音频可能较大 → 关闭 body 缓存、放宽时长。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 音频上传大小硬上限：默认 5MB，可由 env MAX_AUDIO_BYTES 覆盖。
 * 录音 3 分钟内（opus/webm）远低于此；上限防超大上传打爆带宽/存储/后续转写。
 */
const MAX_AUDIO_BYTES = (() => {
  const raw = process.env.MAX_AUDIO_BYTES;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 5 * 1024 * 1024;
})();

/**
 * POST /api/audio —— 上传录音到 OSS（去 Supabase 改造 · Phase C）
 *
 * 取代浏览器端 supabase.storage.from('audio').upload(...)：录音 Blob 由客户端 POST 到这里，
 * 服务端 getCurrentUser() 取 userId、读 body 成 Buffer，调用 uploadAudio() 落 OSS，返回对象 key。
 * 该 key（形如 `audio/{userId}/{uuid}.<ext>`）即 notes.media_path，客户端拿到后走 /api/notes 建记录。
 *
 * 接收两种 body：
 *   - multipart/form-data（字段名 `file`）—— 标准表单上传
 *   - 原始二进制（Content-Type 即音频 MIME，如 audio/webm）—— 直接 PUT Blob
 * contentType 取自 file/请求头，决定 OSS 对象扩展名与 Content-Type。
 *
 * 缺 OSS 配置时（OssConfigMissingError）优雅降级为 503，不在 import 期崩。
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  // 成本/滥用闸：上传按 userId 限流（突发防刷；大上传配额由后续转写的 transcribe 配额承担）。
  const rl = enforceAiRateLimit(user.id, 'audio');
  if (!rl.ok) {
    return NextResponse.json(
      { error: '操作过于频繁，请稍后再试', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    );
  }

  // 输入硬上限（预检）：Content-Length 若已超限，早拒，避免白读超大 body。
  const declaredLen = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredLen) && declaredLen > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: `音频不能超过 ${Math.floor(MAX_AUDIO_BYTES / 1024 / 1024)}MB` },
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
        return NextResponse.json({ error: '缺少音频文件（字段 file）' }, { status: 400 });
      }
      buf = Buffer.from(await file.arrayBuffer());
      // Blob.type 优先；个别浏览器为空时回退 webm。
      contentType = file.type || 'audio/webm';
    } else {
      const ab = await request.arrayBuffer();
      buf = Buffer.from(ab);
      contentType = reqType.split(';')[0].trim() || 'audio/webm';
    }
  } catch {
    return NextResponse.json({ error: '读取上传内容失败' }, { status: 400 });
  }

  if (buf.length === 0) {
    return NextResponse.json({ error: '音频内容为空' }, { status: 400 });
  }
  // 实际字节硬上限（Content-Length 可能缺失/不可信，以真实读到的为准）。
  if (buf.length > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: `音频不能超过 ${Math.floor(MAX_AUDIO_BYTES / 1024 / 1024)}MB` },
      { status: 413 }
    );
  }

  try {
    const { key } = await uploadAudio(user.id, buf, contentType);
    return NextResponse.json({ key });
  } catch (err) {
    if (err instanceof OssConfigMissingError) {
      // 优雅降级：未配置 OSS 时返回可读信息，而非 500 堆栈。
      console.error('[audio] OSS 未配置：', err.message);
      return NextResponse.json({ error: '存储未配置，音频上传暂不可用' }, { status: 503 });
    }
    console.error('[audio] 上传失败：', err);
    return NextResponse.json({ error: '音频上传失败' }, { status: 500 });
  }
}
