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
import { randomInt } from 'node:crypto';

/** bcrypt cost factor（迭代轮数 = 2^12）。安全与性能折中的常用值。 */
export const BCRYPT_COST = 12;

/** 密码最小长度（与注册接口、前端校验保持一致）。 */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * 服务端生成强随机密码字符集：去掉易混字符（0/O、1/l/I），其余大小写字母 + 数字 + 少量符号。
 * 仅用于「管理员建号」省略密码时由服务端生成、一次性回传给管理员转交的场景。
 */
const GENERATED_PASSWORD_ALPHABET =
  'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*';

/**
 * 用 crypto 强随机源生成一个高熵密码（默认 16 位）。
 * - 用 `node:crypto` 的 `randomInt`（无模偏，CSPRNG），逐位从无歧义字符集取字符。
 * - 16 位 × 约 62 种字符 ≈ 95 bit 熵，远超暴力破解门槛；最低不少于 MIN_PASSWORD_LENGTH。
 * 返回的明文仅在内存中短暂存在，用后即弃（绝不落库 / 日志，仅一次性回传管理员）。
 */
export function generateStrongPassword(length = 16): string {
  const len = Math.max(length, MIN_PASSWORD_LENGTH);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += GENERATED_PASSWORD_ALPHABET[randomInt(0, GENERATED_PASSWORD_ALPHABET.length)];
  }
  return out;
}

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
