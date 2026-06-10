import DigestNowButton from '@/features/digest/components/DigestNowButton';
import PushToggle from '@/features/review/components/PushToggle';

export const metadata = { title: '设置 · 小M' };

export default function SettingsPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 pb-24 pt-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-brand">设置</h1>
      </header>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
          AI 整理
        </h2>
        <p className="text-xs text-zinc-400">
          系统每晚 23:00（北京时间）自动整理当天记录。也可以现在手动触发。
        </p>
        <DigestNowButton />
      </section>

      <section className="mt-8 space-y-2">
        <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
          复习提醒
        </h2>
        <PushToggle />
      </section>
    </main>
  );
}
