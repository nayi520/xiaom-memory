/**
 * OSS 存储封装（去 Supabase 改造 · 阿里云对象存储 OSS）
 *
 * 替代 Supabase Storage（bucket `audio`）。导出与现状一一对应、便于平替的接口：
 *   - uploadAudio(userId, body, contentType) → { key }   ← 对应 supabase.storage.from('audio').upload(path, ...)
 *   - getSignedUrl(key, expiresSec?)         → string     ← 对应 .createSignedUrl(path, 3600)
 *   - getPublicTaskUrl(key, expiresSec?)     → string     ← 给 Fun-ASR 录音文件识别拉取的公网 URL（用签名 URL）
 *   - downloadBuffer(key)                    → Buffer      ← 对应 .download(path)（transcribe 取音频用）
 *
 * 对象 key 规则：`audio/{userId}/{uuid}.<ext>`（整串即 notes.media_path）。
 * 与旧版的差异：Supabase 里 bucket(`audio`) 与 path(`{userId}/{uuid}.webm`) 分离，存库的 media_path 不含 `audio/` 前缀；
 * OSS 没有 bucket-as-path 概念，故把 `audio/` 收进对象 key，整串 key 写入 media_path。接线阶段需注意这一前缀变化。
 *
 * 配置全部从 env 读取，且**仅在调用时读取**（import 期绝不连接 / 不抛错），缺配置时抛 OssConfigMissingError，
 * 由调用方（api 路由）按现有「优雅降级」套路处理。
 *
 * 依赖：`ali-oss`（运行时）+ `@types/ali-oss`（开发时）。详见同目录 DEPS.md。
 */

import OSS from 'ali-oss';

/** 音频对象 key 的统一前缀（取代旧 Supabase bucket 名 `audio`）。 */
export const AUDIO_PREFIX = 'audio';

/** 头像对象 key 的统一前缀（用户资料头像，私有 bucket，展示靠签名 URL）。 */
export const AVATAR_PREFIX = 'avatars';

/** 捕获图片对象 key 的统一前缀（图片捕获 V13，私有 bucket，展示/OCR 靠签名 URL）。 */
export const IMAGE_PREFIX = 'images';

/** 签名 URL 默认有效期：1 小时（与旧 createSignedUrl(path, 3600) 对齐）。 */
export const DEFAULT_EXPIRES_SEC = 3600;

/** 缺少 OSS 配置时抛出，供调用方优雅降级（不在 import 期崩）。 */
export class OssConfigMissingError extends Error {
  constructor(missing: string[]) {
    super(`未配置 OSS 环境变量：${missing.join(', ')}`);
    this.name = 'OssConfigMissingError';
  }
}

interface OssConfig {
  region: string;
  bucket: string;
  accessKeyId: string;
  accessKeySecret: string;
  /** 可选：自定义/内网 endpoint（如 oss-cn-guangzhou-internal.aliyuncs.com）。设了优先于 region。 */
  endpoint?: string;
}

/**
 * 仅在调用时读取 env 并校验。缺任一必填项 → OssConfigMissingError。
 * 必填：OSS_REGION、OSS_BUCKET、OSS_ACCESS_KEY_ID、OSS_ACCESS_KEY_SECRET
 * 可选：OSS_ENDPOINT
 */
function readConfig(): OssConfig {
  const region = process.env.OSS_REGION;
  const bucket = process.env.OSS_BUCKET;
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET;
  const endpoint = process.env.OSS_ENDPOINT;

  const missing: string[] = [];
  if (!region) missing.push('OSS_REGION');
  if (!bucket) missing.push('OSS_BUCKET');
  if (!accessKeyId) missing.push('OSS_ACCESS_KEY_ID');
  if (!accessKeySecret) missing.push('OSS_ACCESS_KEY_SECRET');
  if (missing.length > 0) throw new OssConfigMissingError(missing);

  return {
    region: region!,
    bucket: bucket!,
    accessKeyId: accessKeyId!,
    accessKeySecret: accessKeySecret!,
    endpoint: endpoint || undefined,
  };
}

/**
 * 构造 OSS client（每次调用新建，无模块级单例 → 避免 import 期初始化、便于无状态 serverless 环境）。
 * `secure: true` 让签名 URL 走 https。设了 endpoint 时优先用 endpoint（如内网域名）。
 */
function makeClient(): OSS {
  const cfg = readConfig();
  return new OSS({
    region: cfg.region,
    bucket: cfg.bucket,
    accessKeyId: cfg.accessKeyId,
    accessKeySecret: cfg.accessKeySecret,
    ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
    secure: true,
  });
}

/** content-type → 文件扩展名。覆盖录音常见类型，未命中回退 .bin。 */
function extFromContentType(contentType: string): string {
  const ct = contentType.split(';')[0].trim().toLowerCase();
  const map: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/aac': 'aac',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/ogg': 'ogg',
  };
  return map[ct] ?? 'bin';
}

/** 生成随机 uuid（Node 18+ 全局有 crypto.randomUUID）。 */
function randomUuid(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * 上传音频到 `audio/{userId}/{uuid}.<ext>`，返回对象 key（写入 notes.media_path）。
 * 对应：supabase.storage.from('audio').upload(path, blob, { contentType })。
 *
 * @param userId      当前用户 id（应用层鉴权得到，决定 key 前缀，隔离各用户）
 * @param body        音频字节（Buffer 或 Uint8Array；Buffer 是 Uint8Array 子类，统一传给 ali-oss put）
 * @param contentType MIME 类型（如 audio/webm），决定扩展名与对象 Content-Type 头
 */
export async function uploadAudio(
  userId: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<{ key: string }> {
  if (!userId) throw new Error('uploadAudio: 缺少 userId');
  const client = makeClient();
  const ext = extFromContentType(contentType);
  const key = `${AUDIO_PREFIX}/${userId}/${randomUuid()}.${ext}`;

  // ali-oss put 接收 Buffer；Uint8Array 统一包成 Buffer（零拷贝视图）。
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body.buffer, body.byteOffset, body.byteLength);

  await client.put(key, buf, {
    mime: contentType,
    headers: { 'Content-Type': contentType },
  });

  return { key };
}

/**
 * 头像 content-type → 文件扩展名。仅支持 png / jpeg / webp（与上传校验一致），未命中回退 bin。
 * 与音频不同，头像类型受控（路由层已白名单校验），故映射表也只含这三种。
 */
function avatarExtFromContentType(contentType: string): string {
  const ct = contentType.split(';')[0].trim().toLowerCase();
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
  };
  return map[ct] ?? 'bin';
}

/**
 * 上传头像到 `avatars/{userId}/{uuid}.<ext>`，返回对象 key（写入 users.avatar_key）。
 * 与 uploadAudio 同构：复用 makeClient / randomUuid，仅前缀与扩展名映射不同。
 * 私有 bucket，展示一律用 getSignedUrl 现签（库里只存 key）。
 *
 * @param userId      当前用户 id（应用层鉴权得到，决定 key 前缀，隔离各用户）
 * @param body        图片字节（Buffer 或 Uint8Array）
 * @param contentType MIME 类型（image/png | image/jpeg | image/webp），决定扩展名与对象 Content-Type 头
 */
export async function uploadAvatar(
  userId: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<{ key: string }> {
  if (!userId) throw new Error('uploadAvatar: 缺少 userId');
  const client = makeClient();
  const ext = avatarExtFromContentType(contentType);
  const key = `${AVATAR_PREFIX}/${userId}/${randomUuid()}.${ext}`;

  // ali-oss put 接收 Buffer；Uint8Array 统一包成 Buffer（零拷贝视图）。
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body.buffer, body.byteOffset, body.byteLength);

  await client.put(key, buf, {
    mime: contentType,
    headers: { 'Content-Type': contentType },
  });

  return { key };
}

/**
 * 上传捕获图片到 `images/{userId}/{uuid}.<ext>`，返回对象 key（写入 notes.media_path）。
 * 与 uploadAudio / uploadAvatar 同构：复用 makeClient / randomUuid，仅前缀与扩展名映射不同。
 * 私有 bucket，展示与 OCR 一律用 getSignedUrl 现签（库里只存 key）。
 * 扩展名映射复用 avatarExtFromContentType（同为 png/jpeg/webp 白名单，路由层已校验）。
 *
 * @param userId      当前用户 id（应用层鉴权得到，决定 key 前缀，隔离各用户）
 * @param body        图片字节（Buffer 或 Uint8Array）
 * @param contentType MIME 类型（image/png | image/jpeg | image/webp），决定扩展名与对象 Content-Type 头
 */
export async function uploadImage(
  userId: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<{ key: string }> {
  if (!userId) throw new Error('uploadImage: 缺少 userId');
  const client = makeClient();
  const ext = avatarExtFromContentType(contentType);
  const key = `${IMAGE_PREFIX}/${userId}/${randomUuid()}.${ext}`;

  // ali-oss put 接收 Buffer；Uint8Array 统一包成 Buffer（零拷贝视图）。
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body.buffer, body.byteOffset, body.byteLength);

  await client.put(key, buf, {
    mime: contentType,
    headers: { 'Content-Type': contentType },
  });

  return { key };
}

/**
 * 生成临时签名 GET URL（播放用），默认 1 小时。
 * 对应：supabase.storage.from('audio').createSignedUrl(path, 3600) → data.signedUrl。
 *
 * 注意：ali-oss 的 signatureUrl 是同步方法，这里用 async 包一层以对齐「将来可平替为 STS/异步实现」的接口形状。
 *
 * @param key        对象 key（= notes.media_path）
 * @param expiresSec 有效期秒数，默认 3600
 */
export async function getSignedUrl(
  key: string,
  expiresSec: number = DEFAULT_EXPIRES_SEC
): Promise<string> {
  if (!key) throw new Error('getSignedUrl: 缺少 key');
  const client = makeClient();
  return client.signatureUrl(key, { expires: expiresSec, method: 'GET' });
}

/**
 * 给 Fun-ASR（百炼录音文件异步识别）用的、公网可访问的音频 URL。
 * Fun-ASR 只收公网 URL 并自行拉取音频，签名 GET URL 即满足。默认给较长有效期（2 小时），
 * 覆盖「提交任务 → 排队 → 识别」的异步窗口。
 *
 * 实现上等同 getSignedUrl，单列一个语义化入口，便于接线阶段调用方表达意图，
 * 也便于将来若 Fun-ASR 改走内网/专用域名时只改这一处。
 *
 * @param key        对象 key（= notes.media_path）
 * @param expiresSec 有效期秒数，默认 7200（2 小时）
 */
export async function getPublicTaskUrl(
  key: string,
  expiresSec: number = 2 * 60 * 60
): Promise<string> {
  return getSignedUrl(key, expiresSec);
}

/**
 * 下载对象为 Buffer（如服务端转写需要本地读取字节时用）。
 * 对应：supabase.storage.from('audio').download(path) → Blob。
 *
 * @param key 对象 key（= notes.media_path）
 */
export async function downloadBuffer(key: string): Promise<Buffer> {
  if (!key) throw new Error('downloadBuffer: 缺少 key');
  const client = makeClient();
  const result = await client.get(key);
  const content = (result as { content?: unknown }).content;
  if (Buffer.isBuffer(content)) return content;
  if (content instanceof Uint8Array) return Buffer.from(content);
  // ali-oss 在 Node 下 content 通常是 Buffer；兜底处理其它情形。
  return Buffer.from(content as ArrayBuffer);
}
