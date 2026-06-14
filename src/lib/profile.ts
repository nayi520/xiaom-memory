/**
 * 用户资料公共逻辑（供 /api/me、/api/profile、/api/profile/avatar 复用）。
 *
 * - 显示名校验：trim 后要求 1–24 字符（与 iOS 端契约一致）。
 * - 头像 key 现签：仅当 key 归属当前用户（`avatars/{userId}/` 前缀）才签，防越权；
 *   缺 OSS 配置 / 签名失败一律降级为 null，不让资料读取整体失败。
 */

import {
  getSignedUrl,
  OssConfigMissingError,
  AVATAR_PREFIX,
} from '@/lib/storage/oss';

/** 显示名长度边界（trim 后，含中英文按字符计）。 */
export const NAME_MIN = 1;
export const NAME_MAX = 24;

export interface ProfileView {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

/**
 * 校验并归一化显示名：trim 后空/超长返回 null（视为非法），否则返回 trim 结果。
 * 调用方据此返回 400 或写库。
 */
export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length < NAME_MIN || trimmed.length > NAME_MAX) return null;
  return trimmed;
}

/**
 * 对头像 key 现签为临时 URL。
 * - key 为空 / 不归属该用户 → null（不签，防越权）。
 * - 缺 OSS 配置 / 签名失败 → null（降级，调用方不因此报错）。
 */
export async function signAvatarUrl(
  userId: string,
  avatarKey: string | null
): Promise<string | null> {
  if (!avatarKey || !avatarKey.startsWith(`${AVATAR_PREFIX}/${userId}/`)) {
    return null;
  }
  try {
    return await getSignedUrl(avatarKey);
  } catch (err) {
    if (!(err instanceof OssConfigMissingError)) {
      console.error('[profile] 头像签名失败：', err);
    }
    return null;
  }
}
