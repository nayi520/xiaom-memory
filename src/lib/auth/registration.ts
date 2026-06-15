/**
 * 注册门禁：注册模式 + 邀请码 —— 注册门禁加固
 *
 * 让注册可安全开放。三档模式（env REGISTRATION_MODE，默认 invite）：
 *   - open   ：免邀请码，任何人可注册（仍受邮箱验证 + 限频约束）。
 *   - invite ：必须带**有效、未过期、used_count<max_uses** 的邀请码；成功时**事务内** used_count+1。
 *   - closed ：完全关闭注册（→ 403）。
 *
 * 邀请码消费用 `UPDATE ... WHERE used_count < max_uses AND (expires_at IS NULL OR expires_at > now())
 *   RETURNING` 的**原子自增**，天然防并发超发（无需显式锁/事务隔离级别）。
 *
 * 安全：邀请码不是机密凭据，但仍按「有效性」校验；不打印任何敏感信息。
 */

import { randomInt } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { inviteCodes } from '@/lib/db/schema';

export type RegistrationMode = 'open' | 'invite' | 'closed';

/** 读取注册模式（默认 invite）。非法值回落到 invite（更安全的默认）。 */
export function getRegistrationMode(): RegistrationMode {
  const raw = (process.env.REGISTRATION_MODE ?? '').trim().toLowerCase();
  if (raw === 'open' || raw === 'closed' || raw === 'invite') return raw;
  return 'invite';
}

/** 邀请码字符集：去掉易混字符（0/O、1/I/L），降低人工抄写出错率。 */
const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * 生成一个随机邀请码（默认 10 位，带一个连字符便于阅读，如 `ABCDE-FGHJK`）。
 * 用 crypto 随机源；非机密用途，长度足够避免碰撞/枚举。
 */
export function generateInviteCode(length = 10): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += INVITE_ALPHABET[randomInt(0, INVITE_ALPHABET.length)];
    // 中间插一个连字符（仅长度为偶数时居中），纯展示友好。
    if (length >= 8 && i === Math.floor(length / 2) - 1) out += '-';
  }
  return out;
}

/**
 * 原子消费一个邀请码：仅当**存在 + 未过期 + used_count<max_uses** 时自增 used_count 并返回 true。
 * 并发安全：单条 UPDATE 的 WHERE 守卫 + RETURNING，数据库层面保证不超发。
 *
 * @returns true=消费成功（已 +1）；false=码无效/已用尽/已过期/不存在。
 */
export async function consumeInviteCode(code: string): Promise<boolean> {
  const trimmed = code.trim();
  if (!trimmed) return false;
  const db = getDb();
  const rows = await db
    .update(inviteCodes)
    .set({ usedCount: sql`${inviteCodes.usedCount} + 1` })
    .where(
      sql`${inviteCodes.code} = ${trimmed}
        AND ${inviteCodes.usedCount} < ${inviteCodes.maxUses}
        AND (${inviteCodes.expiresAt} IS NULL OR ${inviteCodes.expiresAt} > now())`
    )
    .returning({ code: inviteCodes.code });
  return rows.length > 0;
}

/**
 * 创建一个邀请码（管理员发码端点用）。
 * @param opts.code      指定码；缺省自动生成。
 * @param opts.note      备注（发给谁/用途）。
 * @param opts.maxUses   最大可用次数（默认 1）。
 * @param opts.expiresAt 过期时间（缺省永不过期）。
 * @returns 落库后的邀请码记录（含最终 code）。
 */
export async function createInviteCode(opts: {
  code?: string;
  note?: string | null;
  maxUses?: number;
  expiresAt?: Date | null;
}): Promise<{
  code: string;
  note: string | null;
  maxUses: number;
  usedCount: number;
  expiresAt: Date | null;
}> {
  const db = getDb();
  const code = (opts.code?.trim() || generateInviteCode());
  const maxUses = Number.isInteger(opts.maxUses) && (opts.maxUses as number) > 0
    ? (opts.maxUses as number)
    : 1;
  const [row] = await db
    .insert(inviteCodes)
    .values({
      code,
      note: opts.note ?? null,
      maxUses,
      expiresAt: opts.expiresAt ?? null,
    })
    .returning();
  return {
    code: row.code,
    note: row.note ?? null,
    maxUses: row.maxUses,
    usedCount: row.usedCount,
    expiresAt: row.expiresAt ?? null,
  };
}
