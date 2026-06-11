/**
 * Magic link 邮件 provider + 正文模板 —— 去 Supabase 改造（P2 自研鉴权）
 *
 * 关键设计：**不依赖 nodemailer**。
 *   next-auth 自带的 Nodemailer / Email provider 在模块顶层 `import { createTransport } from "nodemailer"`，
 *   会强制把 nodemailer 拉进运行时（即便我们完全自定义 sendVerificationRequest 也躲不掉，
 *   因为 import 阶段就会解析该包）。本项目发信走阿里云 DirectMail（HTTP），根本用不到 SMTP，
 *   因此这里**手工构造一个 `type:'email'` 的 provider 配置对象**（EmailConfig），
 *   只填 Auth.js 真正需要的字段（id/type/name/from/maxAge/sendVerificationRequest）。
 *   Auth.js 对 email 类型 provider 的令牌生成/校验走 adapter（见 adapter.ts），与本 provider 解耦。
 *
 * 正文模板为纯函数、无副作用，便于后续替换品牌样式 / 文案。
 */

import type { NextAuthConfig } from 'next-auth';
import { sendMail } from './directmail';

const BRAND = '小M';

/** magic link 默认有效期（秒）：10 分钟，平衡安全与可用。 */
export const MAGIC_LINK_MAX_AGE = 10 * 60;

/**
 * provider 配置元素类型（= NextAuthConfig.providers 的元素）。
 * 不直接 import EmailConfig/Provider 具体名，从 NextAuthConfig 推导，
 * 避免 next-auth 公共类型导出名变动导致 import 失败。
 */
type ProviderElement = NonNullable<NextAuthConfig['providers']>[number];

/**
 * 构造「DirectMail 发信」的 magic link provider（type:'email'，无 nodemailer 依赖）。
 * 用法：providers: [ directMailProvider(), Apple(...) ]
 *
 * 说明：Auth.js 对 email 类型 provider 不做 OAuth 那套 normalize（仅原样合并），
 * 令牌生成走内置默认（未提供 generateVerificationToken），令牌存取走 adapter；
 * 这里只需提供 id/type/name/from/maxAge + 自定义 sendVerificationRequest。
 */
export function directMailProvider(): ProviderElement {
  return {
    id: 'email',
    type: 'email',
    name: 'Email',
    // from 仅用于令牌标识展示，真正发信地址走 DirectMail 的 AccountName / FromAlias。
    from: process.env.DIRECTMAIL_ACCOUNT_NAME ?? 'no-reply@localhost',
    maxAge: MAGIC_LINK_MAX_AGE,
    // server 走 SMTP，本项目不用（发信走 DirectMail HTTP）；options 占位空对象。
    server: undefined,
    options: {},
    // 显式标注参数类型（对象经 `as` 断言，回调参数无上下文推断，避免 noImplicitAny）。
    async sendVerificationRequest({
      identifier,
      url,
    }: {
      identifier: string;
      url: string;
    }) {
      const { host } = new URL(url);
      await sendMail({
        to: identifier,
        subject: magicLinkSubject(),
        html: magicLinkHtml({ url, host }),
        text: magicLinkText({ url, host }),
      });
    },
  } as ProviderElement;
}

export function magicLinkSubject(): string {
  return `登录 ${BRAND}`;
}

/** HTML 正文：单一行动按钮 + 纯文本兜底链接 + 失效提示 */
export function magicLinkHtml(params: { url: string; host: string }): string {
  const { url, host } = params;
  // 注意：邮件客户端对 CSS 支持有限，使用内联样式 + 简单结构。
  return `<!doctype html>
<html lang="zh-CN">
  <body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border-radius:12px;padding:36px 32px;">
            <tr>
              <td style="font-size:20px;font-weight:600;color:#111827;padding-bottom:8px;">登录 ${BRAND}</td>
            </tr>
            <tr>
              <td style="font-size:14px;line-height:22px;color:#4b5563;padding-bottom:24px;">
                点击下面的按钮即可登录到 <strong>${host}</strong>。链接 10 分钟内有效，只能使用一次。
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:24px;">
                <a href="${url}" target="_blank"
                   style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 28px;border-radius:8px;">
                  登录 ${BRAND}
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
                如果你没有尝试登录，请忽略本邮件。
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** 纯文本兜底（部分客户端不渲染 HTML） */
export function magicLinkText(params: { url: string; host: string }): string {
  return `登录 ${BRAND}\n\n点击以下链接登录到 ${params.host}（10 分钟内有效，仅能使用一次）：\n${params.url}\n\n如果你没有尝试登录，请忽略本邮件。`;
}
