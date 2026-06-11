/**
 * 阿里云 DirectMail（邮件推送）发信工具 —— 去 Supabase 改造（P2 自研鉴权）
 *
 * 用途：为 Auth.js Email magic link 的 `sendVerificationRequest` 提供底层发信能力，
 *       也可供后续业务通知复用。走 DirectMail `SingleSendMail` 接口（RPC 风格，
 *       API 版本 2015-11-23），用 AccessKey 做 HMAC-SHA1 签名。
 *
 * 设计原则（对齐 embeddings.ts / llm.ts）：
 *   - **import 期不报错**：缺配置不在模块加载时抛，只有真正发信时校验，避免构建/无关路由崩溃。
 *   - 缺配置时抛 DirectMailConfigError（含缺失项名），调用方可优雅降级 / 返回明确错误。
 *   - 仅依赖 Node 内置 crypto + 全局 fetch（Node 18+），不引第三方阿里云 SDK。
 *
 * 环境变量：
 *   DIRECTMAIL_ACCESS_KEY_ID      RAM 子账号 AccessKeyId（具备 DirectMail 发信权限）
 *   DIRECTMAIL_ACCESS_KEY_SECRET  对应 AccessKeySecret
 *   DIRECTMAIL_REGION             地域（默认 cn-hangzhou；DirectMail 仅杭州/新加坡/悉尼提供 endpoint）
 *   DIRECTMAIL_ACCOUNT_NAME       已验证的发信地址（如 no-reply@mail.nayitools.cn）
 *   DIRECTMAIL_FROM_ALIAS         发信人昵称（可选，如「小M」）
 *
 * 参考：DirectMail OpenAPI / RPC 签名机制（POST，
 *   StringToSign = "POST" + "&" + percentEncode("/") + "&" + percentEncode(sortedQuery)，
 *   HMAC-SHA1(AccessKeySecret + "&", StringToSign) → Base64）。
 */

import { createHmac, randomUUID } from 'node:crypto';

export class DirectMailConfigError extends Error {
  constructor(missing: string[]) {
    super(`未配置 DirectMail 必需环境变量：${missing.join(', ')}`);
    this.name = 'DirectMailConfigError';
  }
}

/** DirectMail 接口返回非 2xx 时抛出（含阿里云错误码 / 文本，便于排查） */
export class DirectMailRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string;
  constructor(status: number, body: string, code?: string, requestId?: string) {
    super(
      `DirectMail SingleSendMail ${status}${code ? `（${code}）` : ''}：${body.slice(0, 300)}`
    );
    this.name = 'DirectMailRequestError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export interface SendMailInput {
  /** 收件人邮箱；支持单个或多个（多个用逗号拼接，DirectMail 单次最多 100） */
  to: string | string[];
  /** 邮件主题 */
  subject: string;
  /** HTML 正文 */
  html: string;
  /** 纯文本正文（可选；不传时不携带 TextBody） */
  text?: string;
}

export interface DirectMailConfig {
  accessKeyId: string;
  accessKeySecret: string;
  region: string;
  accountName: string;
  fromAlias?: string;
}

/**
 * 读取并校验 DirectMail 配置。缺任一必需项 → DirectMailConfigError。
 * 不在 import 期调用，确保模块加载绝不因缺 env 崩溃。
 */
export function getDirectMailConfig(): DirectMailConfig {
  const accessKeyId = process.env.DIRECTMAIL_ACCESS_KEY_ID;
  const accessKeySecret = process.env.DIRECTMAIL_ACCESS_KEY_SECRET;
  const accountName = process.env.DIRECTMAIL_ACCOUNT_NAME;
  const region = process.env.DIRECTMAIL_REGION ?? 'cn-hangzhou';
  const fromAlias = process.env.DIRECTMAIL_FROM_ALIAS;

  const missing: string[] = [];
  if (!accessKeyId) missing.push('DIRECTMAIL_ACCESS_KEY_ID');
  if (!accessKeySecret) missing.push('DIRECTMAIL_ACCESS_KEY_SECRET');
  if (!accountName) missing.push('DIRECTMAIL_ACCOUNT_NAME');
  if (missing.length > 0) throw new DirectMailConfigError(missing);

  return {
    accessKeyId: accessKeyId!,
    accessKeySecret: accessKeySecret!,
    region,
    accountName: accountName!,
    fromAlias,
  };
}

/** 是否已配置 DirectMail（供调用方优雅降级判断，不抛错） */
export function isDirectMailConfigured(): boolean {
  return Boolean(
    process.env.DIRECTMAIL_ACCESS_KEY_ID &&
      process.env.DIRECTMAIL_ACCESS_KEY_SECRET &&
      process.env.DIRECTMAIL_ACCOUNT_NAME
  );
}

/** DirectMail RPC endpoint（按地域）。DirectMail 仅在杭州/新加坡/悉尼有 POP。 */
function endpointForRegion(region: string): string {
  // 已知 DirectMail Region → endpoint 映射；未知地域回落到杭州。
  switch (region) {
    case 'ap-southeast-1':
      return 'https://dm.ap-southeast-1.aliyuncs.com';
    case 'ap-southeast-2':
      return 'https://dm.ap-southeast-2.aliyuncs.com';
    case 'cn-hangzhou':
    default:
      return 'https://dm.aliyuncs.com';
  }
}

/**
 * 阿里云 RPC 风格 percent-encode（RFC 3986，且把 +/*~ 做特殊处理）。
 * 与签名算法配套：encodeURIComponent 后修正三处差异。
 */
function rpcEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/\+/g, '%20')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~');
}

/**
 * 计算 RPC 签名（Signature）。
 * StringToSign = HTTPMethod + "&" + rpcEncode("/") + "&" + rpcEncode(canonicalizedQuery)
 * Signature    = Base64(HMAC-SHA1(AccessKeySecret + "&", StringToSign))
 */
function sign(params: Record<string, string>, accessKeySecret: string): string {
  const canonical = Object.keys(params)
    .sort()
    .map((k) => `${rpcEncode(k)}=${rpcEncode(params[k])}`)
    .join('&');

  const stringToSign = `POST&${rpcEncode('/')}&${rpcEncode(canonical)}`;
  return createHmac('sha1', `${accessKeySecret}&`)
    .update(stringToSign)
    .digest('base64');
}

/**
 * 发送一封邮件（HTML 正文）。
 *
 * @throws DirectMailConfigError  缺必需环境变量
 * @throws DirectMailRequestError DirectMail 返回非 2xx
 */
export async function sendMail(input: SendMailInput): Promise<{ requestId?: string }> {
  const cfg = getDirectMailConfig();
  const toAddress = Array.isArray(input.to) ? input.to.join(',') : input.to;

  // —— 公共参数 + 业务参数（除 Signature 外全部参与签名）——
  const params: Record<string, string> = {
    // 公共参数
    Format: 'JSON',
    Version: '2015-11-23',
    AccessKeyId: cfg.accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: randomUUID(),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    RegionId: cfg.region,
    // 业务参数（SingleSendMail）
    Action: 'SingleSendMail',
    AccountName: cfg.accountName,
    AddressType: '1', // 1 = 发信地址（管理控制台已验证），与 ReplyToAddress 配套
    ReplyToAddress: 'false',
    ToAddress: toAddress,
    Subject: input.subject,
    HtmlBody: input.html,
  };
  if (input.text) params.TextBody = input.text;
  if (cfg.fromAlias) params.FromAlias = cfg.fromAlias;

  params.Signature = sign(params, cfg.accessKeySecret);

  // RPC 走 application/x-www-form-urlencoded（同 URLSearchParams 的常规编码即可，
  // 因签名用的是 rpcEncode，但 body 本身只需标准 form 编码，服务端按 key 取值后自行规范化校验）。
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) form.append(k, v);

  const res = await fetch(endpointForRegion(cfg.region), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });

  const bodyText = await res.text();
  if (!res.ok) {
    // 阿里云错误返回 JSON：{ RequestId, HostId, Code, Message }
    let code: string | undefined;
    let requestId: string | undefined;
    try {
      const j = JSON.parse(bodyText) as { Code?: string; RequestId?: string };
      code = j.Code;
      requestId = j.RequestId;
    } catch {
      /* 非 JSON 错误体，忽略解析 */
    }
    throw new DirectMailRequestError(res.status, bodyText, code, requestId);
  }

  let requestId: string | undefined;
  try {
    const j = JSON.parse(bodyText) as { RequestId?: string };
    requestId = j.RequestId;
  } catch {
    /* 成功但非 JSON，忽略 */
  }
  return { requestId };
}
