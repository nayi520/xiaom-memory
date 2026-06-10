'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>(
    'idle'
  );
  const [errorMsg, setErrorMsg] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('sending');
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setErrorMsg(error.message);
      setStatus('error');
    } else {
      setStatus('sent');
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-3xl font-bold text-brand">小M</h1>
        <p className="mt-2 text-center text-sm text-zinc-500">
          你负责遇见，小M 替你记得。
        </p>

        {status === 'sent' ? (
          <div className="mt-10 rounded-xl bg-brand-light p-6 text-center dark:bg-zinc-800">
            <p className="text-base font-medium">登录链接已发送 ✉️</p>
            <p className="mt-2 text-sm text-zinc-500">
              请查收 {email} 的邮件，点击魔法链接完成登录。
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-10 space-y-4">
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
              disabled={status === 'sending'}
              className="w-full rounded-xl bg-brand px-4 py-3 text-base font-medium text-white transition active:scale-[0.98] disabled:opacity-60"
            >
              {status === 'sending' ? '发送中…' : '发送魔法链接'}
            </button>
            {status === 'error' && (
              <p className="text-sm text-red-500">发送失败：{errorMsg}</p>
            )}
          </form>
        )}
      </div>
    </main>
  );
}
