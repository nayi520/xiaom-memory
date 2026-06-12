'use client';

import { Suspense, useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { emailSignIn, appleSignIn } from './actions';
import { Button, Input } from '@/components/ui';

export default function LoginPage() {
  // useSearchParams 需包在 Suspense 内，否则静态导出时触发 CSR bailout 报错。
  return (
    <Suspense fallback={<LoginShell />}>
      <LoginForm />
    </Suspense>
  );
}

/**
 * 把 Auth.js 回流的 ?error=<type> 映射为可读中文提示。
 *
 * 关键场景：邮箱魔法链接发信走 DirectMail，未配置/失败时 sendMail 抛
 * DirectMail*Error（普通 Error，非 AuthError）。该异常在 Auth.js 的
 * sendVerificationRequest 内抛出后，@auth/core 顶层会将其归类为 "Configuration"
 * 并 302 回 pages.error（即本页）带 ?error=Configuration —— 不是白屏/500，
 * 但默认只会显示泛化文案。这里据 type 给出「邮件发送失败」等可读提示。
 *
 * 其它常见 type：EmailSignInError / Verification（魔法链接相关）、
 * AccessDenied（拒绝授权）、OAuth* / Callback（Apple 等第三方回调）。
 */
function authErrorMessage(type: string): string {
  switch (type) {
    case 'Configuration':
    case 'EmailSignInError':
      return '邮件发送失败，请稍后重试或联系管理员。';
    case 'Verification':
      return '登录链接已失效或已被使用，请重新发送。';
    case 'AccessDenied':
      return '登录被拒绝，请确认已授权后重试。';
    default:
      return '登录失败，请稍后重试。';
  }
}

/** 品牌标识：圆角方块 + 字标，登录页与空壳共用。 */
function BrandMark() {
  return (
    <div className="flex flex-col items-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-brand-dark text-2xl font-bold text-white shadow-pop">
        小M
      </div>
      <h1 className="mt-5 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        小M Memory
      </h1>
      <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
        你负责遇见，小M 替你记得。
      </p>
    </div>
  );
}

/** 加载占位：与表单同壳，避免闪烁 */
function LoginShell() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm animate-fade-in">
        <BrandMark />
      </div>
    </main>
  );
}

function AppleLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor" aria-hidden>
      <path d="M17.05 12.04c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.1-2.01-3.77-2.04-1.6-.16-3.13.94-3.94.94-.81 0-2.07-.92-3.4-.9-1.75.03-3.36 1.02-4.26 2.58-1.82 3.16-.47 7.83 1.3 10.4.86 1.25 1.89 2.66 3.24 2.61 1.3-.05 1.79-.84 3.36-.84 1.57 0 2.01.84 3.39.81 1.4-.02 2.29-1.28 3.15-2.54.99-1.46 1.4-2.87 1.42-2.94-.03-.01-2.73-1.05-2.76-4.15-.02-.01.85 0 .85 0ZM14.6 4.5c.72-.87 1.2-2.08 1.07-3.28-1.03.04-2.28.69-3.02 1.56-.66.77-1.24 2-1.08 3.18 1.15.09 2.32-.59 3.03-1.46Z" />
    </svg>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  // Auth.js Email magic link 发出后会 redirect 到 verifyRequest（/login?check=email）。
  const sent = searchParams.get('check') === 'email';
  // 登录错误回流（pages.error 指向 /login，Auth.js 带 ?error=...）。
  const authError = searchParams.get('error');

  const [email, setEmail] = useState('');
  const [errorMsg, setErrorMsg] = useState(authError ? authErrorMessage(authError) : '');
  const [isPending, startTransition] = useTransition();

  function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setErrorMsg('');
    const fd = new FormData();
    fd.set('email', email.trim());
    startTransition(async () => {
      // 成功时 server action 抛 redirect，页面会跳到 ?check=email，不会走到下一行。
      const res = await emailSignIn(fd);
      if (res?.error) setErrorMsg(res.error);
    });
  }

  function handleApple() {
    setErrorMsg('');
    startTransition(async () => {
      const res = await appleSignIn();
      if (res?.error) setErrorMsg(res.error);
    });
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm animate-fade-in-up">
        <BrandMark />

        {sent ? (
          <div className="mt-10 animate-scale-in rounded-card border border-brand/15 bg-brand-light/70 p-6 text-center dark:border-brand/20 dark:bg-brand/10">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-2xl shadow-card dark:bg-zinc-900">
              ✉️
            </div>
            <p className="text-base font-semibold text-zinc-800 dark:text-zinc-100">
              登录链接已发送
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
              请查收邮件，点击魔法链接完成登录。
              <br />
              链接 10 分钟内有效。
            </p>
          </div>
        ) : (
          <>
            <form onSubmit={handleEmailSubmit} className="mt-10 space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-zinc-600 dark:text-zinc-400">
                  邮箱
                </span>
                <Input
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </label>
              <Button type="submit" size="lg" fullWidth loading={isPending}>
                {isPending ? '发送中…' : '发送魔法链接'}
              </Button>
            </form>

            <div className="my-6 flex items-center gap-3 text-xs text-zinc-400">
              <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
              或
              <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            </div>

            <button
              type="button"
              onClick={handleApple}
              disabled={isPending}
              className="flex w-full items-center justify-center gap-2 rounded-field bg-black px-4 py-3.5 text-base font-semibold text-white shadow-card transition duration-150 ease-smooth hover:bg-zinc-800 active:scale-[0.98] disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
            >
              <AppleLogo />
              使用 Apple 登录
            </button>

            {errorMsg && (
              <p
                role="alert"
                className="mt-4 rounded-field border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
              >
                {errorMsg}
              </p>
            )}
          </>
        )}

        <p className="mt-10 text-center text-xs text-zinc-400 dark:text-zinc-600">
          首次登录将自动创建账户
        </p>
      </div>
    </main>
  );
}
