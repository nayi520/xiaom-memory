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
import ExportLibraryButtons from '@/features/settings/components/ExportLibraryButtons';
import ImportMarkdownCard from '@/features/settings/components/ImportMarkdownCard';
import LlmCheckButton from '@/features/settings/components/LlmCheckButton';
import ShortcutsHelpEntry from '@/features/settings/components/ShortcutsHelpEntry';
import { OnboardingSettings } from '@/features/onboarding';
import {
  PageShell,
  SectionTitle,
  ThemeToggle,
  TrashIcon,
  TagIcon,
  InsightsIcon,
  AskIcon,
  ChevronRight,
  SiteFooter,
  cardClass,
  cn,
} from '@/components/ui';

export const metadata = { title: '设置 · 小M' };

/** 展示用版本号（与 package.json 一致；改版本只改这里的展示，不影响构建）。 */
const APP_VERSION = '0.1.0';

export default function SettingsPage() {
  return (
    <PageShell width="wide">
      <header className="mb-6 lg:mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 lg:text-3xl dark:text-zinc-50">
          设置
        </h1>
        <p className="mt-1 text-sm text-zinc-400">账户、数据、偏好与帮助都在这里</p>
      </header>

      {/* ============ 账户：个人资料 + 账户安全 ============ */}
      <section aria-labelledby="settings-account" className="mb-10">
        <SectionTitle className="mb-3" id="settings-account">
          账户
        </SectionTitle>
        <div className="space-y-4">
          <div className="space-y-2.5">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">个人资料</p>
            <ProfileCard />
          </div>
          <div className="space-y-2.5">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">账户安全</p>
            <ChangePasswordCard />
          </div>
        </div>
      </section>

      {/* ============ 数据与统计：统计概览 + 洞察入口 + 复习热力 + 备份/导入 ============ */}
      <section aria-labelledby="settings-data" className="mb-10">
        <SectionTitle className="mb-3" id="settings-data">
          数据与统计
        </SectionTitle>

        <div className="space-y-2.5">
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
              <span className="hidden text-xs font-normal text-zinc-400 sm:inline">
                成长曲线 · 领域分布 · 成就 · 体检
              </span>
            </span>
            <ChevronRight
              aria-hidden
              className="h-4 w-4 text-zinc-300 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand dark:text-zinc-600"
            />
          </Link>
        </div>

        {/* 复习统计：年度热力图 + 保留率 + 今日已复习 */}
        <div className="mt-6 space-y-2.5">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">复习统计</p>
          <ReviewHeatmap />
        </div>

        {/* 我的数据（V21）：全量备份下载 + Markdown 导入。各类数量见上方统计；清空入口在回收站内。 */}
        <div className="mt-6 space-y-2.5">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">我的数据</p>
          <p className="max-w-prose text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            你的记录、概念、卡片、复习记录与设置都属于你。可随时下载一份完整备份带走，或把外部 Markdown 导入小M。
          </p>
          <div className="grid gap-6 lg:grid-cols-2 lg:gap-x-10">
            <div className="space-y-2.5">
              <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">下载全部数据</p>
              <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                导出当前账号的全部数据（记录正文、概念、卡片含复习状态、标签、关联、复习记录、设置）为一份 JSON 文件，可作真备份。
              </p>
              <ExportAllButton />
            </div>
            <div className="space-y-2.5">
              <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">导入 Markdown</p>
              <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                上传 .md 文件或粘贴文本，按二级标题切分为多条、或整篇作为一条记录导入，交由 AI 自动整理。
              </p>
              <ImportMarkdownCard />
            </div>
          </div>
        </div>
      </section>

      {/* ============ 偏好：外观 + 复习提醒 + AI 整理 + 周报（桌面双栏 / 超宽三栏） ============ */}
      <section aria-labelledby="settings-prefs" className="mb-10">
        <SectionTitle className="mb-3" id="settings-prefs">
          偏好
        </SectionTitle>
        <div className="grid gap-8 lg:grid-cols-2 lg:gap-x-10 lg:gap-y-9 2xl:grid-cols-3">
          <div className="space-y-2.5">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">外观</p>
            <ThemeToggle />
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">复习提醒</p>
            <ReviewDailyGoalPicker />
            <ReminderTimePicker />
            <QuietHoursPicker />
            <PushToggle />
            <DigestEmailPicker />
          </div>

          <div className="space-y-2.5">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">AI 整理</p>
            <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
              系统每晚 23:00（北京时间）自动整理当天记录。也可以现在手动触发。
            </p>
            <DigestNowButton />
            <p className="pt-1 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
              切换 AI 供应商（如智谱 GLM / Kimi）后，点此实测当前供应商：连通性、延迟、模型，并看一段示例总结判断质量。
            </p>
            <LlmCheckButton />
          </div>

          <div className="space-y-2.5">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">本周周报</p>
            <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
              把本周的每日整理与新概念汇总成一份知识周报。可随时手动生成、查看最新一期。
            </p>
            <WeeklyDigestPanel />
          </div>
        </div>
      </section>

      {/* ============ 导出与管理：导出知识库/Anki + 回收站 ============ */}
      <section aria-labelledby="settings-export" className="mb-10">
        <SectionTitle className="mb-3" id="settings-export">
          导出与管理
        </SectionTitle>
        <div className="grid gap-8 lg:grid-cols-2 lg:gap-x-10">
          <div className="space-y-5">
            <div className="space-y-2.5">
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">导出我的知识库</p>
              <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                把全部记录（排除回收站）导出带走：JSON 结构化备份（含概念、标签，便于再导入），或一份按时间倒序的可读 Markdown 文档（每条含正文、为什么重要与来源）。
              </p>
              <ExportLibraryButtons />
            </div>

            <div className="space-y-2.5">
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">导出知识库（按概念）</p>
              <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                把整理后的概念（按领域 › 主题组织，附其下原始记录）导出为一份 Markdown 文件，方便备份或迁移。
              </p>
              <ExportMarkdownButton />
              <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                或把复习卡片导出为 Anki 可导入的 CSV（问题, 答案, 概念），在 Anki「文件 → 导入」中加载。
              </p>
              <ExportAnkiButton />
            </div>
          </div>

          <div className="space-y-2.5">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">记录管理</p>
            <Link
              href="/library/tags"
              className={cn(
                cardClass({ interactive: true, padded: false }),
                'group flex items-center justify-between px-4 py-4'
              )}
            >
              <span className="flex items-center gap-2.5 font-medium text-zinc-800 dark:text-zinc-100">
                <TagIcon aria-hidden className="h-[18px] w-[18px] text-zinc-400 dark:text-zinc-500" />
                标签管理
                <span className="hidden text-xs font-normal text-zinc-400 sm:inline">
                  改名 · 合并 · 删除
                </span>
              </span>
              <ChevronRight
                aria-hidden
                className="h-4 w-4 text-zinc-300 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand dark:text-zinc-600"
              />
            </Link>
            <p className="text-sm leading-relaxed text-zinc-400">
              统一整理知识库里的标签：合并重复、改正错字、清理不再使用的标签。
            </p>
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
          </div>
        </div>
      </section>

      {/* ============ 帮助与关于：使用帮助 + 键盘快捷键 + 重看引导 + 关于/版本 ============ */}
      <section aria-labelledby="settings-help" className="mb-6">
        <SectionTitle className="mb-3" id="settings-help">
          帮助与关于
        </SectionTitle>
        <div className="grid gap-8 lg:grid-cols-2 lg:gap-x-10">
          <div className="space-y-2.5">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">使用与快捷键</p>
            <ShortcutsHelpEntry />
            <OnboardingSettings />
          </div>

          <div className="space-y-2.5">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">关于小M</p>
            <AboutCard />
          </div>
        </div>
      </section>

      <p className="mt-10 text-center text-xs text-zinc-300 dark:text-zinc-700">
        小M · 你负责遇见，小M 替你记得
      </p>
      {/* ICP 备案号：设置页底部一行小字（移动端可达，不破坏底部 Tab）。 */}
      <SiteFooter variant="compact" className="mt-2" />
    </PageShell>
  );
}

/** 关于 / 版本卡片：产品简介 + 版本号 + 法务/帮助互链（纯展示）。 */
function AboutCard() {
  return (
    <div className={cn(cardClass({ padded: false }), 'overflow-hidden')}>
      <div className="flex items-center justify-between gap-3 px-4 py-3.5">
        <span className="flex items-center gap-2.5">
          <AskIcon aria-hidden className="h-[18px] w-[18px] text-brand" />
          <span className="font-semibold text-zinc-800 dark:text-zinc-100">小M Memory</span>
        </span>
        <span className="rounded-pill bg-zinc-100 px-2.5 py-0.5 text-xs font-medium tabular-nums text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          v{APP_VERSION}
        </span>
      </div>
      <p className="border-t border-zinc-100 px-4 py-3 text-sm leading-relaxed text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        基于记忆曲线的个人知识记忆系统。捕获想法，AI 自动整理成概念，按遗忘曲线适时复习。
      </p>
      <nav
        aria-label="关于与法务"
        className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-zinc-100 px-4 py-3 text-sm dark:border-zinc-800"
      >
        <Link href="/guide" className="text-zinc-500 transition hover:text-brand dark:text-zinc-400">
          使用帮助
        </Link>
        <Link href="/terms" className="text-zinc-500 transition hover:text-brand dark:text-zinc-400">
          用户协议
        </Link>
        <Link href="/privacy" className="text-zinc-500 transition hover:text-brand dark:text-zinc-400">
          隐私政策
        </Link>
      </nav>
    </div>
  );
}
