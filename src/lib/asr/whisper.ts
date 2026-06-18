/**
 * 语音转写 · OpenAI Whisper 备选位（预留接口 · 默认不启用）
 *
 * 现状：默认 ASR 走 DashScope Fun-ASR（见 ./funasr.ts），转写入口 /api/transcribe 直接调用它，
 * **默认行为不变**。本文件为「可配 ASR provider」预留 OpenAI Whisper（whisper-1）的接口位与降级骨架，
 * 暂不接入业务（接入成本相对较高：Whisper 是「上传二进制 → 同步拿文本」，与 Fun-ASR 的
 * 「提交公网 URL → 异步轮询」形态不同，需要把 OSS 对象先下载为 Blob 再 multipart 上传）。
 *
 * 形态对齐 funasr.ts（导出同名错误类前缀 + transcribeAudioUrl 同签名），便于将来在
 * 转写入口按 env `ASR_PROVIDER`（whisper|funasr，默认 funasr）做分发而**不改调用方契约**。
 *
 * env（接入时启用，未配置/未启用时不影响默认 Fun-ASR）：
 *   - ASR_PROVIDER=whisper        切到 Whisper（默认 funasr）
 *   - WHISPER_API_KEY / OPENAI_API_KEY   Whisper 的 API Key（缺则抛 AsrKeyMissingError → 调用入口优雅降级）
 *   - WHISPER_BASE_URL            OpenAI 兼容根端点，默认 https://api.openai.com/v1
 *   - WHISPER_MODEL               默认 whisper-1
 *
 * 复用 funasr.ts 的错误类型，保证调用入口的 instanceof 降级判断对两种 provider 一致。
 */

import { AsrKeyMissingError, AsrTranscribeError, type TranscribeOpts } from './funasr';

/** 当前 ASR provider（env ASR_PROVIDER，默认 funasr）。供转写入口将来分发用。 */
export type AsrProviderId = 'funasr' | 'whisper';

export function resolveAsrProvider(): AsrProviderId {
  const raw = (process.env.ASR_PROVIDER ?? 'funasr').trim().toLowerCase();
  return raw === 'whisper' ? 'whisper' : 'funasr';
}

/** Whisper 模型名（默认 whisper-1，可经 env 覆盖）。 */
export const WHISPER_MODEL = (process.env.WHISPER_MODEL ?? 'whisper-1').trim() || 'whisper-1';

function whisperBaseUrl(): string {
  const raw = (process.env.WHISPER_BASE_URL ?? 'https://api.openai.com/v1').trim();
  return raw.replace(/\/+$/, '');
}

function whisperApiKey(): string | undefined {
  const k = (process.env.WHISPER_API_KEY ?? process.env.OPENAI_API_KEY ?? '').trim();
  return k === '' ? undefined : k;
}

/**
 * 用 OpenAI Whisper 转写一个公网音频 URL，返回整段文本。
 *
 * 与 funasr.transcribeAudioUrl **同签名同返回形态**，便于在转写入口按 ASR_PROVIDER 无缝切换。
 *
 * 现为接口位 + 骨架：已实现「缺 key → AsrKeyMissingError」「URL 校验」「下载 → multipart 上传 →
 * 解析文本」的完整路径，但**默认不被任何调用方启用**（ASR_PROVIDER 缺省 funasr）。
 * 接入前请在 staging 充分验证音频下载/上传体积与超时。
 *
 * @throws AsrKeyMissingError  未配置 WHISPER_API_KEY / OPENAI_API_KEY（调用入口据此优雅降级）
 * @throws AsrTranscribeError  下载 / 上传 / 解析失败
 */
export async function transcribeAudioUrl(
  audioUrl: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  opts: TranscribeOpts = {}
): Promise<{ text: string }> {
  const apiKey = whisperApiKey();
  if (!apiKey) throw new AsrKeyMissingError();

  if (!audioUrl || !/^https?:\/\//i.test(audioUrl)) {
    throw new AsrTranscribeError(
      `Whisper 需要公网可访问的音频 URL（http/https），收到：${String(audioUrl).slice(0, 120)}`
    );
  }

  // 1) 把 OSS 音频对象下载为内存 Blob（Whisper 走 multipart 上传，不接受远程 URL）。
  let audioBlob: Blob;
  try {
    const dl = await fetch(audioUrl, { method: 'GET' });
    if (!dl.ok) {
      throw new AsrTranscribeError(`Whisper 下载音频失败 HTTP ${dl.status}`);
    }
    audioBlob = await dl.blob();
  } catch (err) {
    if (err instanceof AsrTranscribeError) throw err;
    throw new AsrTranscribeError(
      `Whisper 下载音频网络错误：${err instanceof Error ? err.message : String(err)}`
    );
  }

  // 2) multipart/form-data 上传到 /audio/transcriptions，拿同步文本。
  const form = new FormData();
  // 文件名后缀仅作提示，OpenAI 按内容解码；从 URL 取个合理后缀。
  const guessedName = audioUrl.split('?')[0].split('/').pop() || 'audio.webm';
  form.append('file', audioBlob, guessedName);
  form.append('model', WHISPER_MODEL);
  form.append('response_format', 'json');
  if (opts.language) form.append('language', opts.language);

  let res: Response;
  try {
    res = await fetch(`${whisperBaseUrl()}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` }, // 不手动设 content-type，交给 FormData 带 boundary
      body: form,
    });
  } catch (err) {
    throw new AsrTranscribeError(
      `Whisper 上传转写网络错误：${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!res.ok) {
    const detail = await res.text();
    throw new AsrTranscribeError(`Whisper 转写失败 HTTP ${res.status}：${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as { text?: string };
  return { text: (data.text ?? '').trim() };
}

// TODO（接入 ASR 多供应商时）：
//   1) 在 /api/transcribe 入口按 resolveAsrProvider() 选择本模块或 funasr.transcribeAudioUrl；
//      两者签名/返回/错误类型一致，instanceof 降级判断无需改动。
//   2) 评估音频体积上限（multipart 下载到内存）与 maxDuration；Whisper 单文件 25MB 限制需校验。
//   3) 在 .env.example 中放开 ASR_PROVIDER / WHISPER_* 注释。
