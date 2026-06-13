'use client';

import { Suspense, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn as credentialsSignIn } from 'next-auth/react';
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
 * 其它常见 type：CredentialsSignin（邮箱+密码校验失败）、
 * EmailSignInError / Verification（魔法链接相关）、
 * AccessDenied（拒绝授权）、OAuth* / Callback（Apple 等第三方回调）。
 */
function authErrorMessage(type: string): string {
  switch (type) {
    case 'CredentialsSignin':
      return '邮箱或密码错误。';
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

/** 登录成功后的落地页（与 server action 的 redirectTo 一致）。 */
const POST_LOGIN_REDIRECT = '/';
/** 密码最小长度（与 /api/register、password.ts 保持一致）。 */
const MIN_PASSWORD_LENGTH = 8;

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Auth.js Email magic link 发出后会 redirect 到 verifyRequest（/login?check=email）。
  const sent = searchParams.get('check') === 'email';
  // 登录错误回流（pages.error 指向 /login，Auth.js 带 ?error=...）。
  const authError = searchParams.get('error');

  // 主表单：邮箱 + 密码；mode 在「登录 / 注册」间切换。
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState(authError ? authErrorMessage(authError) : '');
  const [isPending, startTransition] = useTransition();

  /** 邮箱+密码：登录走 signIn('credentials')，注册先调 /api/register 再自动登录。 */
  function handleCredentialsSubmit(e: React.FormEvent) {
    e.preventDefault();
    const mail = email.trim();
    if (!mail || !password) return;
    if (mode === 'signup' && password.length < MIN_PASSWORD_LENGTH) {
      setErrorMsg(`密码至少需要 ${MIN_PASSWORD_LENGTH} 位`);
      return;
    }
    setErrorMsg('');
    startTransition(async () => {
      try {
        if (mode === 'signup') {
          // 1) 注册：POST /api/register。
          const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: mail, password }),
          });
          if (!res.ok) {
            const data = (await res.json().catch(() => null)) as { error?: string } | null;
            setErrorMsg(data?.error ?? '注册失败，请稍后重试。');
            return;
          }
          // 2) 注册成功后自动登录（下沉到 signIn 流程，复用同一跳转逻辑）。
        }

        // 登录（注册成功后亦走此分支）：redirect:false 以便就地处理错误。
        const result = await credentialsSignIn('credentials', {
          email: mail,
          password,
          redirect: false,
        });

        if (!result || result.error) {
          setErrorMsg(
            mode === 'signup'
              ? '注册成功，但自动登录失败，请直接登录。'
              : authErrorMessage(result?.error ?? 'CredentialsSignin')
          );
          if (mode === 'signup') setMode('signin');
          return;
        }

        // 成功：刷新会话并跳转到落地页。
        router.replace(POST_LOGIN_REDIRECT);
        router.refresh();
      } catch {
        setErrorMsg('网络异常，请稍后重试。');
      }
    });
  }

  /** 次要方式：魔法链接（保留原 server action）。 */
  function handleMagicLink() {
    const mail = email.trim();
    if (!mail) {
      setErrorMsg('请先填写邮箱');
      return;
    }
    setErrorMsg('');
    const fd = new FormData();
    fd.set('email', mail);
    startTransition(async () => {
      // 成功时 server action 抛 redirect，页面会跳到 ?check=email，不会走到下一行。
      const res = await emailSignIn(fd);
      if (res?.error) setErrorMsg(res.error);
    });
  }

  /** 次要方式：Apple 登录（保留原 server action）。 */
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
            {/* —— 主登录方式：邮箱 + 密码 —— */}
            <form onSubmit={handleCredentialsSubmit} className="mt-10 space-y-4">
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
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-zinc-600 dark:text-zinc-400">
                  密码
                </span>
                <Input
                  type="password"
                  required
                  minLength={mode === 'signup' ? MIN_PASSWORD_LENGTH : undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'signup' ? `至少 ${MIN_PASSWORD_LENGTH} 位` : '••••••••'}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                />
              </label>
              <Button type="submit" size="lg" fullWidth loading={isPending}>
                {isPending
                  ? mode === 'signup'
                    ? '注册中…'
                    : '登录中…'
                  : mode === 'signup'
                    ? '注册并登录'
                    : '登录'}
              </Button>
            </form>

            {/* 登录 / 注册切换 */}
            <p className="mt-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
              {mode === 'signin' ? '还没有账户？' : '已有账户？'}{' '}
              <button
                type="button"
                onClick={() => {
                  setMode((m) => (m === 'signin' ? 'signup' : 'signin'));
                  setErrorMsg('');
                }}
                className="font-semibold text-brand hover:underline"
              >
                {mode === 'signin' ? '注册' : '去登录'}
              </button>
            </p>

            {errorMsg && (
              <p
                role="alert"
                className="mt-4 rounded-field border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
              >
                {errorMsg}
              </p>
            )}

            {/* —— 次要登录方式：魔法链接 + Apple（折叠） —— */}
            <details className="mt-8 text-sm">
              <summary className="cursor-pointer select-none text-center text-zinc-400 transition hover:text-zinc-600 dark:hover:text-zinc-300">
                其他登录方式
              </summary>
              <div className="mt-5 space-y-3">
                <button
                  type="button"
                  onClick={handleMagicLink}
                  disabled={isPending}
                  className="flex w-full items-center justify-center gap-2 rounded-field border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-zinc-700 shadow-sm transition duration-150 ease-smooth hover:border-zinc-300 hover:bg-zinc-50 active:scale-[0.98] disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
                >
                  邮箱魔法链接登录
                </button>
                <button
                  type="button"
                  onClick={handleApple}
                  disabled={isPending}
                  className="flex w-full items-center justify-center gap-2 rounded-field bg-black px-4 py-3 text-sm font-semibold text-white shadow-card transition duration-150 ease-smooth hover:bg-zinc-800 active:scale-[0.98] disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
                >
                  <AppleLogo />
                  使用 Apple 登录
                </button>
              </div>
            </details>
          </>
        )}

        <p className="mt-10 text-center text-xs text-zinc-400 dark:text-zinc-600">
          {mode === 'signup' ? '注册即表示同意创建账户' : '登录即表示同意继续使用'}
        </p>
      </div>
    </main>
  );
}
