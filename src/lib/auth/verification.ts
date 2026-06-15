/**
 * 邮箱验证：一次性带过期令牌 + 发信 + 校验落地 —— 注册门禁加固
 *
 * 流程：
 *   注册（/api/register）建 email_verified=false 用户 → issueAndSendVerification()
 *     生成不透明随机 token（带 24h 过期）入 email_verifications，用既有 sendMail() 发链接；
 *   用户点 GET /api/verify-email?token= → consumeVerification()
 *     校验（存在 + 未过期）→ 置 users.email_verified=true → 删 token（一次性）→ 跳 /login。
 *   未验证用户登录被拒 → POST /api/resend-verification 重发（限频，见 route）。
 *
 * 安全红线：**绝不打印 token / 邮箱明文**；token 一次性 + 过期。
 * 优雅降级：DirectMail 未配置时 sendMail 抛 DirectMailConfigError，由上层捕获给可读提示。
 */

import { randomBytes } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { emailVerifications, users } from '@/lib/db/schema';
import { sendMail, isDirectMailConfigured } from './directmail';

const BRAND = '小M';

/** 验证链接有效期（毫秒）：24 小时，比 magic link 宽松（验证非登录、可异步处理）。 */
export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** 生成不透明随机 token（URL 安全）。32 字节 → 43 字符 base64url，足够防枚举。 */
function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** 站点对外 base URL（用于拼验证链接）。优先 AUTH_URL，回落到 NEXT_PUBLIC_SITE_URL。 */
function siteBaseUrl(): string {
  const raw =
    process.env.AUTH_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    'http://localhost:3000';
  return raw.replace(/\/+$/, '');
}

/** 是否具备发信能力（供上层判断：未配置时注册仍成功，但提示去重发/联系管理员）。 */
export function canSendVerification(): boolean {
  return isDirectMailConfigured();
}

/**
 * 为指定用户生成一条验证令牌并发送验证邮件。
 * - 先删该用户的旧令牌（避免堆积、确保「最后一封有效」），再插新令牌；
 * - 发信失败由调用方决定如何兜底（注册时吞掉错误、重发时上报）。
 *
 * @returns 始终不返回 token（避免泄露）；仅在发信失败时抛出底层错误供上层分类。
 */
export async function issueAndSendVerification(params: {
  userId: string;
  email: string;
}): Promise<void> {
  const db = getDb();
  const token = newToken();
  const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_MS);

  // 清旧 + 插新（同一用户始终只保留一条有效令牌）。
  await db.delete(emailVerifications).where(eq(emailVerifications.userId, params.userId));
  await db.insert(emailVerifications).values({
    token,
    userId: params.userId,
    expiresAt,
  });

  const url = `${siteBaseUrl()}/api/verify-email?token=${encodeURIComponent(token)}`;
  await sendMail({
    to: params.email,
    subject: verifySubject(),
    html: verifyHtml({ url }),
    text: verifyText({ url }),
  });
}

/**
 * 消费一个验证令牌：校验有效（存在 + 未过期）→ 置 email_verified=true → 删令牌（一次性）。
 * @returns 'ok' 验证成功；'invalid' 不存在/已用；'expired' 已过期（已顺手清理）。
 */
export async function consumeVerification(
  token: string
): Promise<'ok' | 'invalid' | 'expired'> {
  const trimmed = token.trim();
  if (!trimmed) return 'invalid';
  const db = getDb();

  const [row] = await db
    .select({
      token: emailVerifications.token,
      userId: emailVerifications.userId,
      expiresAt: emailVerifications.expiresAt,
    })
    .from(emailVerifications)
    .where(eq(emailVerifications.token, trimmed))
    .limit(1);

  if (!row) return 'invalid';

  if (row.expiresAt.getTime() <= Date.now()) {
    // 过期即清理，不留垃圾。
    await db.delete(emailVerifications).where(eq(emailVerifications.token, trimmed));
    return 'expired';
  }

  // 置已验证 + 删令牌（一次性）。两步顺序无强一致要求：先标记再删，重复点击第二次走 invalid。
  await db.update(users).set({ emailVerified: true }).where(eq(users.id, row.userId));
  await db.delete(emailVerifications).where(eq(emailVerifications.token, trimmed));
  return 'ok';
}

/**
 * 按邮箱查找一个**未验证**用户（重发验证用）。
 * 故意不区分「邮箱不存在」与「已验证」——对外统一不暴露账户存在性。
 * @returns 命中未验证用户返回 {id,email}；否则 null。
 */
export async function findUnverifiedUserByEmail(
  email: string
): Promise<{ id: string; email: string } | null> {
  const db = getDb();
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      emailVerified: users.emailVerified,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!row || row.emailVerified) return null;
  return { id: row.id, email: row.email ?? email };
}

/** 顺手清理过期令牌（best-effort，被调用处忽略错误）。 */
export async function purgeExpiredVerifications(): Promise<void> {
  const db = getDb();
  await db.delete(emailVerifications).where(lt(emailVerifications.expiresAt, new Date()));
}

// ============ 邮件模板（纯函数，无副作用） ============

export function verifySubject(): string {
  return `验证你的 ${BRAND} 邮箱`;
}

export function verifyHtml(params: { url: string }): string {
  const { url } = params;
  return `<!doctype html>
<html lang="zh-CN">
  <body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border-radius:12px;padding:36px 32px;">
            <tr>
              <td style="font-size:20px;font-weight:600;color:#111827;padding-bottom:8px;">验证你的邮箱</td>
            </tr>
            <tr>
              <td style="font-size:14px;line-height:22px;color:#4b5563;padding-bottom:24px;">
                欢迎使用 <strong>${BRAND}</strong>。点击下面的按钮完成邮箱验证，验证后即可登录。链接 24 小时内有效，只能使用一次。
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:24px;">
                <a href="${url}" target="_blank"
                   style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 28px;border-radius:8px;">
                  验证邮箱
                </a>
              </td>
            </tr>
            <tr>
              <td style="font-size:12px;line-height:20px;color:#9ca3af;border-top:1px solid #eef0f2;padding-top:16px;">
                如果按钮无法点击，请复制以下链接到浏览器打开：<br />
                <span style="word-break:break-all;color:#6b7280;">${url}</span>
              </td>
            </tr>
            <tr>
              <td style="font-size:12px;line-height:20px;color:#9ca3af;padding-top:16px;">
                如果你没有注册 ${BRAND}，请忽略本邮件。
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function verifyText(params: { url: string }): string {
  return `验证你的 ${BRAND} 邮箱\n\n点击以下链接完成邮箱验证（24 小时内有效，仅能使用一次）：\n${params.url}\n\n如果你没有注册 ${BRAND}，请忽略本邮件。`;
}
