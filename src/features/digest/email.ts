/**
 * 摘要邮件（V17 智能提醒收官）—— 把已生成的 daily / weekly 摘要按用户开关用 DirectMail 发出。
 *
 * 与 AI 流水线解耦：cron/digest 跑完 runDigestForAllUsers 后调 sendDigestEmails，
 * 据 profiles.settings.digestEmail（'off'|'daily'|'weekly'）筛选用户，取其**最新一期**对应摘要
 * （复用 digests 表既有内容，不重新调 LLM），渲染成邮件发送。
 *
 * 设计原则：
 *   - 无迁移：开关存 profiles.settings.digestEmail；邮件内容取自既有 digests 表。
 *   - 优雅降级：DirectMail 未配置（isDirectMailConfigured=false）整体跳过，不抛错、不阻塞 cron。
 *   - 单用户失败不影响其他用户；汇总 sent/skipped/failed 供 cron 返回排查。
 *   - 不引 markdown 依赖：内置极简、先转义再渲染的 md→HTML（标题/加粗/列表/段落）。
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';
import { digests, profiles, users } from '@/lib/db/schema';
import { sendMail, isDirectMailConfigured } from '@/lib/auth/directmail';

const BRAND = '小M';
/** 站点基址：复用既有 NEXT_PUBLIC_SITE_URL（其次 AUTH_URL），无则回落生产域名。去尾斜杠。 */
const APP_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.AUTH_URL ??
  'https://memory.nayitools.cn'
).replace(/\/+$/, '');

export type DigestEmailMode = 'off' | 'daily' | 'weekly';

export interface DigestEmailResult {
  /** digestEmail != 'off' 的候选用户数 */
  candidates: number;
  /** 实际发出的封数 */
  sent: number;
  /** 跳过数（无邮箱 / 无对应摘要） */
  skipped: number;
  /** 失败数（发信抛错） */
  failed: number;
  /** DirectMail 未配置时为 true（整体跳过，未发任何邮件） */
  mailDisabled: boolean;
  errors: string[];
}

/** 把 settings.digestEmail 收敛为 'off'|'daily'|'weekly'（非法/缺省 'off'）。 */
function resolveDigestEmail(settings: unknown): DigestEmailMode {
  const raw =
    settings && typeof settings === 'object'
      ? (settings as Record<string, unknown>).digestEmail
      : undefined;
  return raw === 'daily' || raw === 'weekly' ? raw : 'off';
}

/**
 * 据 digestEmail 开关给到对应摘要的用户发摘要邮件。
 *
 * @param db   Drizzle 实例（cron 直接传 getDb()）
 * @returns    发送汇总（见 DigestEmailResult）
 */
export async function sendDigestEmails(db: Database): Promise<DigestEmailResult> {
  const result: DigestEmailResult = {
    candidates: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    mailDisabled: false,
    errors: [],
  };

  // DirectMail 未配置：整体跳过（不抛错，cron 照常成功）。
  if (!isDirectMailConfigured()) {
    result.mailDisabled = true;
    return result;
  }

  // 候选用户：profiles.settings.digestEmail in ('daily','weekly') 且有邮箱。
  // join users 取邮箱（profiles.id = users.id）。settings 为 jsonb，用 ->> 取文本筛选。
  const rows = await db
    .select({
      userId: profiles.id,
      email: users.email,
      mode: sql<string>`${profiles.settings}->>'digestEmail'`,
    })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.id))
    .where(sql`${profiles.settings}->>'digestEmail' in ('daily','weekly')`);

  result.candidates = rows.length;

  for (const row of rows) {
    const mode = resolveDigestEmail({ digestEmail: row.mode });
    if (mode === 'off') {
      result.skipped += 1;
      continue;
    }
    if (!row.email) {
      result.skipped += 1;
      continue;
    }

    // 取该用户最新一期对应类型的摘要（daily / weekly），period 字典序倒序即最新。
    let latest: { period: string; contentMd: string } | undefined;
    try {
      const digestRows = await db
        .select({ period: digests.period, contentMd: digests.contentMd })
        .from(digests)
        .where(and(eq(digests.userId, row.userId), eq(digests.type, mode)))
        .orderBy(desc(digests.period))
        .limit(1);
      latest = digestRows[0];
    } catch (err) {
      result.failed += 1;
      result.errors.push(
        `user=${row.userId} 读取摘要失败：${err instanceof Error ? err.message : err}`
      );
      continue;
    }

    if (!latest) {
      // 还没有对应摘要（如今天没整理出 daily，或本周还没生成 weekly）：跳过，不发空邮件。
      result.skipped += 1;
      continue;
    }

    try {
      await sendMail({
        to: row.email,
        subject: digestSubject(mode, latest.period),
        html: digestHtml(mode, latest.period, latest.contentMd),
        text: digestText(mode, latest.period, latest.contentMd),
      });
      result.sent += 1;
    } catch (err) {
      result.failed += 1;
      result.errors.push(
        `user=${row.userId} 发信失败：${err instanceof Error ? err.message : err}`
      );
    }
  }

  return result;
}

// ============ 邮件模板（与 magic link 邮件同品牌样式，纯函数便于测试） ============

export function digestSubject(mode: DigestEmailMode, period: string): string {
  return mode === 'weekly'
    ? `${BRAND} · 本周知识周报（${period}）`
    : `${BRAND} · 今日整理（${period}）`;
}

/** HTML 邮件：标题 + Markdown 渲染区 + 进入小M 按钮。内联样式（邮件客户端 CSS 支持有限）。 */
export function digestHtml(
  mode: DigestEmailMode,
  period: string,
  contentMd: string
): string {
  const heading = mode === 'weekly' ? '本周知识周报' : '今日整理';
  const body = markdownToEmailHtml(contentMd);
  const url = `${APP_URL}/settings`;
  return `<!doctype html>
<html lang="zh-CN">
  <body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:32px 28px;">
            <tr>
              <td style="font-size:13px;color:#10b981;font-weight:600;letter-spacing:.04em;padding-bottom:4px;">${BRAND} · ${period}</td>
            </tr>
            <tr>
              <td style="font-size:20px;font-weight:600;color:#111827;padding-bottom:16px;">${heading}</td>
            </tr>
            <tr>
              <td style="font-size:14px;line-height:24px;color:#374151;">
                ${body}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-top:24px;">
                <a href="${url}" target="_blank"
                   style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 26px;border-radius:8px;">
                  打开${BRAND}
                </a>
              </td>
            </tr>
            <tr>
              <td style="font-size:12px;line-height:20px;color:#9ca3af;border-top:1px solid #eef0f2;padding-top:16px;margin-top:8px;">
                你在「设置 › 摘要邮件」开启了此提醒。如需关闭，前往设置页改为「不发送」。
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** 纯文本兜底：直接给 Markdown 原文（部分客户端不渲染 HTML）。 */
export function digestText(
  mode: DigestEmailMode,
  period: string,
  contentMd: string
): string {
  const heading = mode === 'weekly' ? '本周知识周报' : '今日整理';
  return `${BRAND} · ${heading}（${period}）\n\n${contentMd}\n\n打开${BRAND}：${APP_URL}/settings\n\n你在「设置 › 摘要邮件」开启了此提醒，如需关闭可在设置页改为「不发送」。`;
}

/** HTML 转义（防注入 / 防破坏邮件结构）。先转义，再做受控的 Markdown 替换。 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 行内 Markdown（加粗 **x** / 行内代码 `x`）→ HTML。输入须已 escapeHtml。 */
function inlineMd(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="background:#f3f4f6;padding:1px 4px;border-radius:4px;">$1</code>');
}

/**
 * 极简 Markdown → 邮件 HTML（无依赖）。支持：
 *   - # / ## / ### 标题；- / * / 1. 列表（连续行合并为 <ul>）；空行分段；行内 **加粗** 与 `代码`。
 * 不支持表格 / 图片 / 链接语法（摘要内容本就以标题+列表+短句为主）。先整体转义，杜绝注入。
 */
export function markdownToEmailHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const esc = escapeHtml(line.trim());

    if (!esc) {
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = Math.min(heading[1].length, 6);
      const size = level <= 1 ? 17 : level === 2 ? 15 : 14;
      const text = inlineMd(escapeHtml(heading[2].trim()));
      out.push(
        `<div style="font-size:${size}px;font-weight:600;color:#111827;margin:16px 0 6px;">${text}</div>`
      );
      continue;
    }

    const listItem = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/);
    if (listItem) {
      if (!inList) {
        out.push('<ul style="margin:4px 0 4px;padding-left:20px;">');
        inList = true;
      }
      out.push(
        `<li style="margin:2px 0;">${inlineMd(escapeHtml(listItem[1].trim()))}</li>`
      );
      continue;
    }

    closeList();
    out.push(`<p style="margin:6px 0;">${inlineMd(esc)}</p>`);
  }
  closeList();
  return out.join('\n');
}
