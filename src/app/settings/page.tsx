import Link from 'next/link';
import DigestNowButton from '@/features/digest/components/DigestNowButton';
import PushToggle from '@/features/review/components/PushToggle';
import ReminderTimePicker from '@/features/review/components/ReminderTimePicker';
import { PageShell, SectionTitle, cardClass, cn } from '@/components/ui';

export const metadata = { title: '设置 · 小M' };

export default function SettingsPage() {
  return (
    <PageShell>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          设置
        </h1>
      </header>

      <section className="space-y-2.5">
        <SectionTitle className="mb-1">AI 整理</SectionTitle>
        <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
          系统每晚 23:00（北京时间）自动整理当天记录。也可以现在手动触发。
        </p>
        <DigestNowButton />
      </section>

      <section className="mt-9 space-y-3">
        <SectionTitle className="mb-1">复习提醒</SectionTitle>
        <ReminderTimePicker />
        <PushToggle />
      </section>

      <section className="mt-9 space-y-2.5">
        <SectionTitle className="mb-1">记录管理</SectionTitle>
        <Link
          href="/trash"
          className={cn(
            cardClass({ interactive: true, padded: false }),
            'group flex items-center justify-between px-4 py-4'
          )}
        >
          <span className="flex items-center gap-2.5 font-medium text-zinc-800 dark:text-zinc-100">
            <span aria-hidden>🗑️</span>
            回收站
          </span>
          <span
            className="text-zinc-300 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand dark:text-zinc-600"
            aria-hidden
          >
            ›
          </span>
        </Link>
        <p className="text-sm leading-relaxed text-zinc-400">
          删除的记录会先移到回收站，可恢复或永久删除。
        </p>
      </section>

      <p className="mt-12 text-center text-xs text-zinc-300 dark:text-zinc-700">
        小M · 你负责遇见，小M 替你记得
      </p>
    </PageShell>
  );
}
