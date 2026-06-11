'use client';

import { Suspense, useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { emailSignIn, appleSignIn } from './actions';

export default function LoginPage() {
  // useSearchParams 需包在 Suspense 内，否则静态导出时触发 CSR bailout 报错。
  return (
    <Suspense fallback={<LoginShell />}>
      <LoginForm />
    </Suspense>
  );
}

/** 加载占位：与表单同壳，避免闪烁 */
function LoginShell() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-3xl font-bold text-brand">小M</h1>
        <p className="mt-2 text-center text-sm text-zinc-500">
          你负责遇见，小M 替你记得。
        </p>
      </div>
    </main>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  // Auth.js Email magic link 发出后会 redirect 到 verifyRequest（/login?check=email）。
  const sent = searchParams.get('check') === 'email';
  // 登录错误回流（pages.error 指向 /login，Auth.js 带 ?error=...）。
  const authError = searchParams.get('error');

  const [email, setEmail] = useState('');
  const [errorMsg, setErrorMsg] = useState(authError ? '登录失败，请重试' : '');
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
    <main className="flex min-h-dvh flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-3xl font-bold text-brand">小M</h1>
        <p className="mt-2 text-center text-sm text-zinc-500">
          你负责遇见，小M 替你记得。
        </p>

        {sent ? (
          <div className="mt-10 rounded-xl bg-brand-light p-6 text-center dark:bg-zinc-800">
            <p className="text-base font-medium">登录链接已发送 ✉️</p>
            <p className="mt-2 text-sm text-zinc-500">
              请查收邮件，点击魔法链接完成登录。链接 10 分钟内有效。
            </p>
          </div>
        ) : (
          <>
            <form onSubmit={handleEmailSubmit} className="mt-10 space-y-4">
              <label className="block">
                <span className="mb-1 block text-sm text-zinc-600 dark:text-zinc-400">
                  邮箱
                </span>
                <input
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>
              <button
                type="submit"
                disabled={isPending}
                className="w-full rounded-xl bg-brand px-4 py-3 text-base font-medium text-white transition active:scale-[0.98] disabled:opacity-60"
              >
                {isPending ? '发送中…' : '发送魔法链接'}
              </button>
            </form>

            <div className="my-5 flex items-center gap-3 text-xs text-zinc-400">
              <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
              或
              <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
            </div>

            <button
              type="button"
              onClick={handleApple}
              disabled={isPending}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-black px-4 py-3 text-base font-medium text-white transition active:scale-[0.98] disabled:opacity-60"
            >
               使用 Apple 登录
            </button>

            {errorMsg && <p className="mt-4 text-sm text-red-500">{errorMsg}</p>}
          </>
        )}
      </div>
    </main>
  );
}
