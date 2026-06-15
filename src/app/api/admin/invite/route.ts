/**
 * POST /api/admin/invite —— 管理员生成邀请码（注册门禁加固）
 *
 * 鉴权：Authorization: Bearer ${ADMIN_SECRET}（env）。缺 ADMIN_SECRET → 500；不匹配 → 401。
 *
 * 契约：JSON（全部可选）
 *   `{ note?: string, maxUses?: number, expiresInDays?: number, code?: string }`
 *   - maxUses        默认 1（单次邀请）。
 *   - expiresInDays  缺省 = 永不过期；> 0 时设过期时间。
 *   - code           缺省自动生成；可指定（须唯一）。
 *   → 200 `{ ok: true, code, maxUses, usedCount, expiresAt }`
 *   → 409 `{ error }` 指定 code 冲突。
 *
 * 兜底：也可不走本端点，直接 SQL 直插（见下方注释 / README）。
 * 公开路径但靠 Bearer 鉴权（同 /api/cron 模式）；已加入 middleware PUBLIC_PATHS。
 *
 * —— SQL 直插兜底（在 RDS 执行；强烈建议替换 code/note/有效期）——
 *   insert into invite_codes (code, note, max_uses, expires_at)
 *   values ('FRIEND-2026A', '发给老王', 1, now() + interval '30 days');
 *   -- 永不过期：expires_at 省略或置 null。多次可用：max_uses 调大。
 */

import { NextResponse } from 'next/server';
import { isDatabaseConfigured } from '@/lib/db/client';
import { createInviteCode, getRegistrationMode } from '@/lib/auth/registration';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    return NextResponse.json({ error: '服务端未配置 ADMIN_SECRET' }, { status: 500 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: '鉴权失败' }, { status: 401 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: '服务暂不可用' }, { status: 503 });
  }

  let body: unknown = {};
  try {
    // 允许空 body（生成一个默认码）。
    const text = await req.text();
    if (text.trim()) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }
  const obj = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;

  const note = typeof obj.note === 'string' ? obj.note.trim() || null : null;
  const code = typeof obj.code === 'string' && obj.code.trim() ? obj.code.trim() : undefined;
  const maxUsesRaw = obj.maxUses;
  const maxUses =
    typeof maxUsesRaw === 'number' && Number.isInteger(maxUsesRaw) && maxUsesRaw > 0
      ? maxUsesRaw
      : 1;
  const daysRaw = obj.expiresInDays;
  const expiresInDays =
    typeof daysRaw === 'number' && Number.isFinite(daysRaw) && daysRaw > 0 ? daysRaw : null;
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  try {
    const created = await createInviteCode({ code, note, maxUses, expiresAt });
    return NextResponse.json({
      ok: true,
      code: created.code,
      note: created.note,
      maxUses: created.maxUses,
      usedCount: created.usedCount,
      expiresAt: created.expiresAt,
      // 当前注册模式回显，便于确认邀请码是否会被用到。
      registrationMode: getRegistrationMode(),
    });
  } catch (err) {
    // 主键冲突（指定 code 已存在）→ 409。
    const msg = err instanceof Error ? err.message : String(err);
    if (/duplicate key|unique|primary key/i.test(msg)) {
      return NextResponse.json({ error: '该邀请码已存在' }, { status: 409 });
    }
    return NextResponse.json({ error: '生成失败，请稍后重试' }, { status: 500 });
  }
}
