import Link from 'next/link';
import DigestNowButton from '@/features/digest/components/DigestNowButton';
import WeeklyDigestPanel from '@/features/digest/components/WeeklyDigestPanel';
import PushToggle from '@/features/review/components/PushToggle';
import ReminderTimePicker from '@/features/review/components/ReminderTimePicker';
import StatsPanel from '@/features/settings/components/StatsPanel';
import ReviewHeatmap from '@/features/review/components/ReviewHeatmap';
import ReviewDailyGoalPicker from '@/features/review/components/ReviewDailyGoalPicker';
import QuietHoursPicker from '@/features/settings/components/QuietHoursPicker';
import DigestEmailPicker from '@/features/settings/components/DigestEmailPicker';
import ProfileCard from '@/features/settings/components/ProfileCard';
import ChangePasswordCard from '@/features/settings/components/ChangePasswordCard';
import ExportMarkdownButton from '@/features/settings/components/ExportMarkdownButton';
import ExportAnkiButton from '@/features/settings/components/ExportAnkiButton';
import ExportAllButton from '@/features/settings/components/ExportAllButton';
import ImportMarkdownCard from '@/features/settings/components/ImportMarkdownCard';
import { OnboardingSettings } from '@/features/onboarding';
import {
  PageShell,
  SectionTitle,
  ThemeToggle,
  TrashIcon,
  InsightsIcon,
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

      {/* 账户安全：自助修改 / 设置登录密码（横跨整宽） */}
      <section className="mb-9 space-y-2.5">
        <SectionTitle className="mb-1">账户安全</SectionTitle>
        <ChangePasswordCard />
      </section>

      {/* 数据统计：横跨整宽（四项计数在桌面铺成一行）+ 进入洞察页入口 */}
      <section className="space-y-2.5">
        <SectionTitle className="mb-1">数据统计</SectionTitle>
        <StatsPanel />
        <Link
          href="/insights"
          className={cn(
            cardClass({ interactive: true, padded: false }),
            'group flex items-center justify-between px-4 py-4'
          )}
        >
          <span className="flex items-center gap-2.5 font-medium text-zinc-800 dark:text-zinc-100">
            <InsightsIcon aria-hidden className="h-[18px] w-[18px] text-brand" />
            知识成长洞察
            <span className="text-xs font-normal text-zinc-400">成长曲线 · 领域分布 · 成就 · 体检</span>
          </span>
          <ChevronRight
            aria-hidden
            className="h-4 w-4 text-zinc-300 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand dark:text-zinc-600"
          />
        </Link>
      </section>

      {/* 我的数据（V21 数据管理 & 掌控感）：全量备份下载 + Markdown 导入，横跨整宽。
          各类数量见上方「数据统计」；清空入口在「记录管理 › 回收站」内。 */}
      <section className="mt-9 space-y-2.5">
        <SectionTitle className="mb-1">我的数据</SectionTitle>
        <p className="max-w-prose text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
          你的记录、概念、卡片、复习记录与设置都属于你。可随时下载一份完整备份带走，或把外部 Markdown 导入小M。
        </p>
        <div className="grid gap-9 lg:grid-cols-2 lg:gap-x-10">
          <div className="space-y-2.5">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">下载全部数据</p>
            <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
              导出当前账号的全部数据（记录正文、概念、卡片含复习状态、标签、关联、复习记录、设置）为一份 JSON 文件，可作真备份。
            </p>
            <ExportAllButton />
          </div>
          <div className="space-y-2.5">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">导入 Markdown</p>
            <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
              上传 .md 文件或粘贴文本，按二级标题切分为多条、或整篇作为一条记录导入，交由 AI 自动整理。
            </p>
            <ImportMarkdownCard />
          </div>
        </div>
      </section>

      {/* 复习统计：年度热力图 + 保留率 + 今日已复习（横跨整宽） */}
      <section className="mt-9 space-y-2.5">
        <SectionTitle className="mb-1">复习统计</SectionTitle>
        <ReviewHeatmap />
      </section>

      {/* 其余设置项：桌面双栏铺开、超宽屏三栏，移动端单列堆叠（避免大屏下卡片过宽空荡） */}
      <div className="mt-9 grid gap-9 lg:grid-cols-2 lg:gap-x-10 lg:gap-y-10 2xl:grid-cols-3">
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
          <QuietHoursPicker />
          <PushToggle />
          <DigestEmailPicker />
        </section>

        <section className="space-y-2.5">
          <SectionTitle className="mb-1">导出知识库</SectionTitle>
          <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            把整理后的概念（按领域 › 主题组织，附其下原始记录）导出为一份 Markdown 文件，方便备份或迁移。
          </p>
          <ExportMarkdownButton />
          <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            或把复习卡片导出为 Anki 可导入的 CSV（问题, 答案, 概念），在 Anki「文件 → 导入」中加载。
          </p>
          <ExportAnkiButton />
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
            删除的记录会先移到回收站，可恢复、永久删除单条，或一键清空整个回收站。
          </p>
        </section>

        <section className="space-y-2.5">
          <SectionTitle className="mb-1">使用帮助</SectionTitle>
          <OnboardingSettings />
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
