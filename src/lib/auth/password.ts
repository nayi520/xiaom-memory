/**
 * 密码哈希工具 —— 邮箱+密码登录（V1 鉴权）
 *
 * 用 bcryptjs（纯 JS、免原生编译、适配 Docker standalone）：
 *   - 注册 / 改密：hashPassword() → 存 users.password_hash；
 *   - 登录校验：verifyPassword() → bcrypt.compare（恒定时间比较，防时序攻击）。
 *
 * 安全红线：**绝不存明文、绝不打印密码**。本模块只接收/返回哈希串，不记录任何明文。
 */

import bcrypt from 'bcryptjs';

/** bcrypt cost factor（迭代轮数 = 2^12）。安全与性能折中的常用值。 */
export const BCRYPT_COST = 12;

/** 密码最小长度（与注册接口、前端校验保持一致）。 */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * 生成密码的 bcrypt 哈希（含随机盐）。
 * 仅在注册 / 改密路径调用；输入明文用后即弃，绝不落库/日志。
 */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

/**
 * 校验明文与已存哈希是否匹配（bcrypt.compare，恒定时间）。
 * hash 为空（老魔法链接 / Apple 用户未设密码）时直接返回 false。
 */
export async function verifyPassword(
  plain: string,
  hash: string | null | undefined
): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

/**
 * 邮箱格式宽松校验（注册 / 登录共用）。
 * 不追求 RFC 完备，仅挡明显非法输入；真实可达性由发信/登录环节体现。
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
