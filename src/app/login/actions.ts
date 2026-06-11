'use server';

/**
 * 登录 Server Actions —— 去 Supabase 改造（Auth.js）
 *
 * 用 Auth.js 核心的 signIn（来自 @/lib/auth）：
 *   - emailSignIn：Email magic link（provider id 'email'，发信走 DirectMail）。
 *     成功后 Auth.js 会 redirect 到 verifyRequest（/login?check=email）。
 *   - appleSignIn：Apple OIDC，redirect 到 Apple 授权页。
 *
 * 说明：signIn 在内部通过抛出 redirect 来跳转，故这些 action 正常路径不返回；
 *   仅在「真正出错」（如 DirectMail 未配置）时返回 { error } 供页面提示。
 */

import { signIn } from '@/lib/auth';

/**
 * 判断是否为 Next.js 的 redirect「信号错误」。
 * Auth.js 的 signIn 通过 throw redirect 实现跳转，框架据此识别并执行重定向；
 * 这类错误的 digest 形如 'NEXT_REDIRECT;...'，必须原样向上抛，不能吞掉。
 * 直接按 digest 前缀判断，避免依赖 next/dist 深层内部路径。
 */
function isRedirectError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'digest' in err &&
    typeof (err as { digest?: unknown }).digest === 'string' &&
    (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

export async function emailSignIn(formData: FormData): Promise<{ error: string } | void> {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) return { error: '请输入邮箱' };
  try {
    // redirectTo 登录成功后的落地页；magic link 发出后先到 verifyRequest 页。
    await signIn('email', { email, redirectTo: '/' });
  } catch (err) {
    // signIn 用「抛 redirect」实现跳转，必须原样向上抛，否则跳转失效。
    if (isRedirectError(err)) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `发送失败：${msg}` };
  }
}

export async function appleSignIn(): Promise<{ error: string } | void> {
  try {
    await signIn('apple', { redirectTo: '/' });
  } catch (err) {
    if (isRedirectError(err)) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Apple 登录失败：${msg}` };
  }
}
