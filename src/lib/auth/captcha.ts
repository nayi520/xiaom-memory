/**
 * 轻量自托管验证码：签名算术挑战 —— 注册门禁加固（可选增强）
 *
 * 设计取舍：邀请制本身已挡机器人，验证码是**次要**第二道防线，故选「无状态、零依赖」方案——
 *   不引 svg-captcha（避免改 package.json/lockfile），不落库（无 challenge 表）。
 *   服务端出题（如 3 + 4），把「答案 + 过期时间」用 HMAC-SHA256 签成 token 一并下发；
 *   客户端提交 {token, answer}，服务端只验签 + 验过期 + 比答案，无需服务端存储。
 *
 * 安全性质：
 *   - token 不含明文答案（仅 `exp.signature`），无法从 token 反推答案 → 必须真正算一次；
 *   - HMAC 用 CAPTCHA_SECRET（缺省回落 AUTH_SECRET）防伪造；
 *   - 带过期（默认 10 分钟）防囤积；恒定时间比较防时序。
 *   - 非重放保护（无状态）：同一 token 在有效期内可复用——对「次要防线 + 已有邀请/限频」可接受。
 *
 * 绝不打印密钥 / 答案。
 */

import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/** 挑战有效期（毫秒）：10 分钟。 */
export const CAPTCHA_TTL_MS = 10 * 60 * 1000;

/** 取签名密钥：优先 CAPTCHA_SECRET，回落 AUTH_SECRET（生产应已设）。 */
function captchaSecret(): string {
  return process.env.CAPTCHA_SECRET || process.env.AUTH_SECRET || 'dev-insecure-captcha-secret';
}

/** HMAC-SHA256(payload) 的十六进制摘要。 */
function hmac(payload: string): string {
  return createHmac('sha256', captchaSecret()).update(payload).digest('hex');
}

export interface CaptchaChallenge {
  /** 展示给用户的题面，如 "3 + 4 = ?"。 */
  question: string;
  /** 携带「过期时间.签名」的不透明 token（不含明文答案）。 */
  token: string;
}

/**
 * 生成一道两位以内加/乘算术题，返回题面 + 签名 token。
 * token 形如 `<expMs>.<hmac(answer:expMs)>`，验证时据此还原校验。
 */
export function issueCaptcha(): CaptchaChallenge {
  const a = randomInt(1, 10); // 1..9
  const b = randomInt(1, 10); // 1..9
  const useMul = randomInt(0, 2) === 1; // 一半概率乘法
  const answer = useMul ? a * b : a + b;
  const op = useMul ? '×' : '+';
  const exp = Date.now() + CAPTCHA_TTL_MS;
  const sig = hmac(`${answer}:${exp}`);
  return {
    question: `${a} ${op} ${b} = ?`,
    token: `${exp}.${sig}`,
  };
}

/**
 * 校验用户提交的答案是否匹配 token（验签 + 验过期 + 比答案）。
 * @returns true=通过；false=token 非法/过期/答案错。
 */
export function verifyCaptcha(token: unknown, answer: unknown): boolean {
  if (typeof token !== 'string') return false;
  const ans =
    typeof answer === 'number'
      ? answer
      : typeof answer === 'string' && answer.trim() !== ''
        ? Number(answer.trim())
        : NaN;
  if (!Number.isFinite(ans)) return false;

  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const expStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= Date.now()) return false;

  const expected = hmac(`${ans}:${exp}`);
  // 恒定时间比较，长度不等直接 false。
  if (sig.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

/** 验证码是否启用：默认启用；设 CAPTCHA_DISABLED=1/true 可关闭（如纯邀请制内测）。 */
export function isCaptchaEnabled(): boolean {
  const raw = (process.env.CAPTCHA_DISABLED ?? '').trim().toLowerCase();
  return !(raw === '1' || raw === 'true' || raw === 'yes');
}
