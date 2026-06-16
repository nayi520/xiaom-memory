import Link from 'next/link';
import DigestNowButton from '@/features/digest/components/DigestNowButton';
import WeeklyDigestPanel from '@/features/digest/components/WeeklyDigestPanel';
import PushToggle from '@/features/review/components/PushToggle';
import ReminderTimePicker from '@/features/review/components/ReminderTimePicker';
import StatsPanel from '@/features/settings/components/StatsPanel';
import ReviewHeatmap from '@/features/review/components/ReviewHeatmap';
import ReviewDailyGoalPicker from '@/features/review/components/ReviewDailyGoalPicker';
import ProfileCard from '@/features/settings/components/ProfileCard';
import ExportMarkdownButton from '@/features/settings/components/ExportMarkdownButton';
import {
  PageShell,
  SectionTitle,
  ThemeToggle,
  TrashIcon,
  ChevronRight,
  SiteFooter,
  cardClass,
  cn,
} from '@/components/ui';

export const metadata = { title: '设置 · 小M' };

export default function SettingsPage() {
  return (
    <PageShell width="wide">
      <header className="mb-6 lg:mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 lg:text-3xl dark:text-zinc-50">
          设置
        </h1>
      </header>

      {/* 个人资料：头像 + 显示名 + 邮箱（横跨整宽，置顶） */}
      <section className="mb-9 space-y-2.5">
        <SectionTitle className="mb-1">个人资料</SectionTitle>
        <ProfileCard />
      </section>

      {/* 数据统计：横跨整宽（四项计数在桌面铺成一行） */}
      <section className="space-y-2.5">
        <SectionTitle className="mb-1">数据统计</SectionTitle>
        <StatsPanel />
      </section>

      {/* 复习统计：年度热力图 + 保留率 + 今日已复习（横跨整宽） */}
      <section className="mt-9 space-y-2.5">
        <SectionTitle className="mb-1">复习统计</SectionTitle>
        <ReviewHeatmap />
      </section>

      {/* 其余设置项：桌面双栏铺开，移动端单列堆叠 */}
      <div className="mt-9 grid gap-9 lg:grid-cols-2 lg:gap-x-10 lg:gap-y-10">
        <section className="space-y-2.5">
          <SectionTitle className="mb-1">外观</SectionTitle>
          <ThemeToggle />
        </section>

        <section className="space-y-2.5">
          <SectionTitle className="mb-1">AI 整理</SectionTitle>
          <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            系统每晚 23:00（北京时间）自动整理当天记录。也可以现在手动触发。
          </p>
          <DigestNowButton />
        </section>

        <section className="space-y-2.5">
          <SectionTitle className="mb-1">本周周报</SectionTitle>
          <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            把本周的每日整理与新概念汇总成一份知识周报。可随时手动生成、查看最新一期。
          </p>
          <WeeklyDigestPanel />
        </section>

        <section className="space-y-3">
          <SectionTitle className="mb-1">复习提醒</SectionTitle>
          <ReviewDailyGoalPicker />
          <ReminderTimePicker />
          <PushToggle />
        </section>

        <section className="space-y-2.5">
          <SectionTitle className="mb-1">导出知识库</SectionTitle>
          <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            把整理后的概念（按领域 › 主题组织，附其下原始记录）导出为一份 Markdown 文件，方便备份或迁移。
          </p>
          <ExportMarkdownButton />
        </section>

        <section className="space-y-2.5">
          <SectionTitle className="mb-1">记录管理</SectionTitle>
          <Link
            href="/trash"
            className={cn(
              cardClass({ interactive: true, padded: false }),
              'group flex items-center justify-between px-4 py-4'
            )}
          >
            <span className="flex items-center gap-2.5 font-medium text-zinc-800 dark:text-zinc-100">
              <TrashIcon aria-hidden className="h-[18px] w-[18px] text-zinc-400 dark:text-zinc-500" />
              回收站
            </span>
            <ChevronRight
              aria-hidden
              className="h-4 w-4 text-zinc-300 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand dark:text-zinc-600"
            />
          </Link>
          <p className="text-sm leading-relaxed text-zinc-400">
            删除的记录会先移到回收站，可恢复或永久删除。
          </p>
        </section>
      </div>

      <p className="mt-12 text-center text-xs text-zinc-300 dark:text-zinc-700">
        小M · 你负责遇见，小M 替你记得
      </p>
      {/* ICP 备案号：设置页底部一行小字（移动端可达，不破坏底部 Tab）。 */}
      <SiteFooter variant="compact" className="mt-2" />
    </PageShell>
  );
}
