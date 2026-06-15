'use client';

import { Suspense, useState, useTransition, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn as credentialsSignIn } from 'next-auth/react';
import { emailSignIn, appleSignIn } from './actions';
import { Button, Input, MailIcon } from '@/components/ui';

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

/** 法务页链接（注册同意条款用）。 */
function LegalLinks() {
  return (
    <>
      <Link href="/terms" className="font-medium text-brand hover:underline" target="_blank">
        《用户协议》
      </Link>
      <Link href="/privacy" className="font-medium text-brand hover:underline" target="_blank">
        《隐私政策》
      </Link>
    </>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Auth.js Email magic link 发出后会 redirect 到 verifyRequest（/login?check=email）。
  const sent = searchParams.get('check') === 'email';
  // 登录错误回流（pages.error 指向 /login，Auth.js 带 ?error=...）。
  const authError = searchParams.get('error');
  // 邮箱验证落地回流（/api/verify-email 重定向带 ?verified=1|invalid|expired）。
  const verified = searchParams.get('verified');

  // 主表单：邮箱 + 密码；mode 在「登录 / 注册」间切换。
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // 注册增强字段：邀请码、同意条款、验证码。
  const [inviteCode, setInviteCode] = useState('');
  const [agree, setAgree] = useState(false);
  const [captcha, setCaptcha] = useState<{ question: string; token: string } | null>(null);
  const [captchaDisabled, setCaptchaDisabled] = useState(false);
  const [captchaAnswer, setCaptchaAnswer] = useState('');

  const [errorMsg, setErrorMsg] = useState(authError ? authErrorMessage(authError) : '');
  // 「邮箱未验证」专用提示态：展示重发入口。
  const [needVerifyEmail, setNeedVerifyEmail] = useState<string | null>(
    authError === 'EmailNotVerified' ? '' : null
  );
  // 验证邮件已发出 / 重发成功提示。
  const [verifySentTo, setVerifySentTo] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  /** 拉取一道验证码挑战（注册时用）。失败静默（验证码是次要防线）。 */
  const loadCaptcha = useCallback(async () => {
    try {
      const res = await fetch('/api/captcha', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as
        | { disabled?: boolean; question?: string; token?: string };
      if (data.disabled) {
        setCaptchaDisabled(true);
        setCaptcha(null);
      } else if (data.question && data.token) {
        setCaptchaDisabled(false);
        setCaptcha({ question: data.question, token: data.token });
        setCaptchaAnswer('');
      }
    } catch {
      /* 验证码不可用时不阻塞注册（服务端会据是否启用决定校验）。 */
    }
  }, []);

  // 进入注册模式时拉取验证码。
  useEffect(() => {
    if (mode === 'signup' && !captcha && !captchaDisabled) {
      void loadCaptcha();
    }
  }, [mode, captcha, captchaDisabled, loadCaptcha]);

  /** 邮箱+密码：登录走 signIn('credentials')，注册先调 /api/register（成功后多走邮箱验证）。 */
  function handleCredentialsSubmit(e: React.FormEvent) {
    e.preventDefault();
    const mail = email.trim();
    if (!mail || !password) return;
    if (mode === 'signup') {
      if (password.length < MIN_PASSWORD_LENGTH) {
        setErrorMsg(`密码至少需要 ${MIN_PASSWORD_LENGTH} 位`);
        return;
      }
      if (!agree) {
        setErrorMsg('请阅读并勾选同意《用户协议》和《隐私政策》');
        return;
      }
      if (!captchaDisabled && (!captcha || captchaAnswer.trim() === '')) {
        setErrorMsg('请先完成验证码');
        return;
      }
    }
    setErrorMsg('');
    setNeedVerifyEmail(null);
    startTransition(async () => {
      try {
        if (mode === 'signup') {
          // 1) 注册：POST /api/register（携带邀请码 / 同意 / 验证码）。
          const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: mail,
              password,
              inviteCode: inviteCode.trim() || undefined,
              agree,
              captchaToken: captcha?.token,
              captchaAnswer: captchaAnswer.trim() || undefined,
            }),
          });
          const data = (await res.json().catch(() => null)) as
            | { ok?: boolean; needsVerification?: boolean; error?: string }
            | null;
          if (!res.ok) {
            setErrorMsg(data?.error ?? '注册失败，请稍后重试。');
            // 验证码错/过期：换一道新题，避免卡死。
            if (!captchaDisabled) void loadCaptcha();
            return;
          }
          // 2) 注册成功：若需邮箱验证（默认），引导去验证，不自动登录。
          if (data?.needsVerification) {
            setVerifySentTo(mail);
            setMode('signin');
            return;
          }
          // 极少数情况（既有已验证账户补设密码）→ 直接尝试登录。
        }

        // 登录：redirect:false 以便就地处理错误。
        const result = await credentialsSignIn('credentials', {
          email: mail,
          password,
          redirect: false,
        });

        if (!result || result.error) {
          // 邮箱未验证：Auth.js 回 error=CredentialsSignin + code=EmailNotVerified。
          if (result?.code === 'EmailNotVerified') {
            setNeedVerifyEmail(mail);
            setErrorMsg('');
            return;
          }
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

  /** 重发验证邮件（邮箱未验证态 / 验证链接过期态下用）。限频由后端控制。 */
  function handleResendVerification(targetEmail: string) {
    const mail = (targetEmail || email).trim();
    if (!mail) {
      setErrorMsg('请先填写邮箱');
      return;
    }
    setErrorMsg('');
    startTransition(async () => {
      try {
        const res = await fetch('/api/resend-verification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: mail }),
        });
        if (res.status === 429) {
          setErrorMsg('操作过于频繁，请稍后再试。');
          return;
        }
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          setErrorMsg(data?.error ?? '发送失败，请稍后重试。');
          return;
        }
        // 始终成功外观（不暴露账户存在性）。
        setVerifySentTo(mail);
        setNeedVerifyEmail(null);
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
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 py-12">
      {/* 品牌氛围光：纯装饰，跟随主题色与深浅色，移动端不喧宾夺主 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 bg-gradient-to-b from-brand/10 to-transparent blur-2xl dark:from-brand/15"
      />
      <div className="w-full max-w-sm animate-fade-in-up">
        <BrandMark />

        {sent ? (
          <div className="mt-10 animate-scale-in rounded-card border border-brand/15 bg-brand-light/70 p-6 text-center dark:border-brand/20 dark:bg-brand/10">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-brand shadow-card dark:bg-zinc-900">
              <MailIcon aria-hidden className="h-6 w-6" />
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
            {/* 邮箱验证落地结果提示（点验证链接后回流）。 */}
            {verified === '1' && (
              <p className="mt-8 rounded-field border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400">
                邮箱已验证成功，请登录。
              </p>
            )}
            {(verified === 'expired' || verified === 'invalid') && (
              <div className="mt-8 rounded-field border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                {verified === 'expired'
                  ? '验证链接已过期。'
                  : '验证链接无效或已被使用。'}
                <button
                  type="button"
                  onClick={() => handleResendVerification(email)}
                  disabled={isPending}
                  className="ml-1 font-semibold underline disabled:opacity-60"
                >
                  重新发送验证邮件
                </button>
              </div>
            )}

            {/* 验证邮件已发送提示（注册成功 / 重发成功）。 */}
            {verifySentTo && (
              <div className="mt-8 animate-scale-in rounded-card border border-brand/15 bg-brand-light/70 p-5 text-center dark:border-brand/20 dark:bg-brand/10">
                <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-brand shadow-card dark:bg-zinc-900">
                  <MailIcon aria-hidden className="h-5 w-5" />
                </div>
                <p className="text-base font-semibold text-zinc-800 dark:text-zinc-100">
                  验证邮件已发送
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                  已向 {verifySentTo} 发送验证邮件，请查收并点击链接完成验证后再登录。
                  <br />
                  链接 24 小时内有效。
                </p>
                <button
                  type="button"
                  onClick={() => handleResendVerification(verifySentTo)}
                  disabled={isPending}
                  className="mt-3 text-sm font-semibold text-brand hover:underline disabled:opacity-60"
                >
                  没收到？重新发送
                </button>
              </div>
            )}

            {/* —— 主登录方式：邮箱 + 密码 —— */}
            <form onSubmit={handleCredentialsSubmit} className="mt-8 space-y-4">
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

              {/* —— 注册专属：邀请码 + 验证码 + 同意条款 —— */}
              {mode === 'signup' && (
                <>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-zinc-600 dark:text-zinc-400">
                      邀请码
                      <span className="ml-1 font-normal text-zinc-400">（如有）</span>
                    </span>
                    <Input
                      type="text"
                      value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value)}
                      placeholder="邀请码"
                      autoComplete="off"
                      autoCapitalize="characters"
                    />
                  </label>

                  {!captchaDisabled && captcha && (
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-medium text-zinc-600 dark:text-zinc-400">
                        验证码
                      </span>
                      <div className="flex items-center gap-2">
                        <span
                          className="select-none rounded-field border border-zinc-200 bg-zinc-50 px-3 py-3 text-base font-semibold tabular-nums tracking-wide text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                          aria-label={`计算题 ${captcha.question}`}
                        >
                          {captcha.question}
                        </span>
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={captchaAnswer}
                          onChange={(e) => setCaptchaAnswer(e.target.value)}
                          placeholder="答案"
                          autoComplete="off"
                          className="flex-1"
                        />
                        <button
                          type="button"
                          onClick={() => void loadCaptcha()}
                          className="shrink-0 rounded-field px-2 py-3 text-sm text-zinc-400 transition hover:text-brand"
                          aria-label="换一题"
                          title="换一题"
                        >
                          换一题
                        </button>
                      </div>
                    </label>
                  )}

                  <label className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                    <input
                      type="checkbox"
                      checked={agree}
                      onChange={(e) => setAgree(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-300 text-brand focus:ring-brand/30 dark:border-zinc-600 dark:bg-zinc-800"
                    />
                    <span className="leading-relaxed">
                      我已阅读并同意 <LegalLinks />
                    </span>
                  </label>
                </>
              )}

              <Button type="submit" size="lg" fullWidth loading={isPending}>
                {isPending
                  ? mode === 'signup'
                    ? '注册中…'
                    : '登录中…'
                  : mode === 'signup'
                    ? '注册'
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
                  setNeedVerifyEmail(null);
                }}
                className="font-semibold text-brand hover:underline"
              >
                {mode === 'signin' ? '注册' : '去登录'}
              </button>
            </p>

            {/* 邮箱未验证专用提示（登录被拒时）：给重发入口。 */}
            {needVerifyEmail !== null && (
              <div
                role="alert"
                className="mt-4 rounded-field border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
              >
                请先验证邮箱后再登录。
                <button
                  type="button"
                  onClick={() => handleResendVerification(needVerifyEmail || email)}
                  disabled={isPending}
                  className="ml-1 font-semibold underline disabled:opacity-60"
                >
                  重新发送验证邮件
                </button>
              </div>
            )}

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
                <Button
                  type="button"
                  variant="secondary"
                  size="lg"
                  fullWidth
                  onClick={handleMagicLink}
                  disabled={isPending}
                >
                  邮箱魔法链接登录
                </Button>
                <button
                  type="button"
                  onClick={handleApple}
                  disabled={isPending}
                  className="flex w-full items-center justify-center gap-2 rounded-field bg-black px-4 py-3.5 text-base font-semibold text-white shadow-card transition duration-150 ease-smooth hover:bg-zinc-800 focus-visible:outline-none active:scale-[0.98] disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
                >
                  <AppleLogo />
                  使用 Apple 登录
                </button>
              </div>
            </details>
          </>
        )}

        <p className="mt-10 text-center text-xs text-zinc-400 dark:text-zinc-600">
          继续即表示同意 <LegalLinks />
        </p>
      </div>
    </main>
  );
}
