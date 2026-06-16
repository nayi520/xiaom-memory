/**
 * 使用帮助（/guide，V12）——简明图文讲清怎么用小M：捕获方式、AI 整理、复习评分含义、问小M、知识库。
 *
 * 设计：复用全站 PageShell / Card / icons / token，纯静态内容（无需鉴权数据），深浅色自适应。
 * 入口：设置页「使用帮助」、新手引导文案、命令面板均可达。移动端单列、桌面适度加宽。
 */

import Link from 'next/link';
import {
  PageShell,
  Card,
  TextIcon,
  VoiceIcon,
  LinkIcon,
  AiIcon,
  ReviewIcon,
  LibraryIcon,
  AskIcon,
  ChevronLeft,
  cn,
  type LucideIcon,
} from '@/components/ui';

export const metadata = { title: '使用帮助 · 小M' };

/** 复习四档评分含义（与复习会话 RATING_LABELS / 评分按钮配色一致）。 */
const RATINGS: { n: number; label: string; meaning: string; cls: string }[] = [
  {
    n: 1,
    label: '忘了',
    meaning: '完全想不起来。小M 会很快再次安排这张卡复习。',
    cls: 'text-red-600 border-red-200 bg-red-50 dark:text-red-400 dark:border-red-900 dark:bg-red-950',
  },
  {
    n: 2,
    label: '模糊',
    meaning: '想起来一点但不确定。下次间隔会缩短。',
    cls: 'text-amber-600 border-amber-200 bg-amber-50 dark:text-amber-400 dark:border-amber-900 dark:bg-amber-950',
  },
  {
    n: 3,
    label: '记得',
    meaning: '顺利答对。下次间隔按记忆曲线适度拉长。',
    cls: 'text-emerald-600 border-emerald-200 bg-emerald-50 dark:text-emerald-400 dark:border-emerald-900 dark:bg-emerald-950',
  },
  {
    n: 4,
    label: '轻松',
    meaning: '毫不费力。间隔会拉得更长，省下精力给更需要的卡片。',
    cls: 'text-sky-600 border-sky-200 bg-sky-50 dark:text-sky-400 dark:border-sky-900 dark:bg-sky-950',
  },
];

/** 三种捕获方式。 */
const CAPTURES: { Icon: LucideIcon; title: string; desc: string }[] = [
  {
    Icon: TextIcon,
    title: '文本',
    desc: '直接输入想法、读到的要点或一句灵感。支持 Markdown。',
  },
  {
    Icon: VoiceIcon,
    title: '语音',
    desc: '说一段话，小M 自动转写成文字再整理，适合走路、通勤时随口记录。',
  },
  {
    Icon: LinkIcon,
    title: '链接',
    desc: '贴一个网址，小M 抓取正文要点存下来，剪藏读到的好文章。',
  },
];

export default function GuidePage() {
  return (
    <PageShell width="reading">
      <header className="mb-6 lg:mb-8">
        <Link
          href="/settings"
          className="mb-3 inline-flex items-center gap-0.5 text-sm text-zinc-400 transition hover:text-zinc-600 focus-visible:outline-none dark:hover:text-zinc-300"
        >
          <ChevronLeft aria-hidden className="h-4 w-4" />
          返回设置
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 lg:text-3xl dark:text-zinc-50">
          使用帮助
        </h1>
        <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-zinc-500 lg:text-base dark:text-zinc-400">
          小M 的用法很简单：随手捕获，AI 替你整理，再按记忆曲线复习、随时提问。下面分四块说清楚。
        </p>
      </header>

      <div className="space-y-9">
        {/* 1. 捕获 */}
        <section>
          <GuideHeading Icon={TextIcon} title="一、捕获：先记下来" />
          <p className="mb-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
            在「记录」页（首页）有三种方式，想到什么先记下，不必担心格式或归类——那是小M 的事。
          </p>
          <ul className="grid gap-2.5 sm:grid-cols-3">
            {CAPTURES.map((c) => (
              <li key={c.title}>
                <Card className="h-full" padded>
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/10 text-brand">
                    <c.Icon aria-hidden className="h-[18px] w-[18px]" />
                  </span>
                  <p className="mt-2.5 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                    {c.title}
                  </p>
                  <p className="mt-1 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                    {c.desc}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px] leading-relaxed text-zinc-400">
            小贴士：每条记录可以补一句「为什么重要」，帮助小M 和未来的你理解当时的想法。
          </p>
        </section>

        {/* 2. AI 整理 */}
        <section>
          <GuideHeading Icon={AiIcon} title="二、AI 自动整理" />
          <Card>
            <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
              每晚（北京时间 23:00）小M 会把当天的零散记录：
            </p>
            <ul className="mt-2.5 space-y-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
              <Bullet>提炼成一个个<strong className="font-semibold text-zinc-800 dark:text-zinc-100">概念</strong>，按「领域 › 主题」归入知识库；</Bullet>
              <Bullet>为重要概念生成<strong className="font-semibold text-zinc-800 dark:text-zinc-100">复习卡片</strong>（问答形式）；</Bullet>
              <Bullet>发现概念之间的关联，并写一份当日小结。</Bullet>
            </ul>
            <p className="mt-2.5 text-[13px] leading-relaxed text-zinc-400">
              不想等到晚上？在「设置 › AI 整理」里可以立即手动触发一次。
            </p>
          </Card>
        </section>

        {/* 3. 复习评分含义 */}
        <section>
          <GuideHeading Icon={ReviewIcon} title="三、复习：评分代表什么" />
          <p className="mb-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
            到「复习」页翻开卡片，先回想答案，再翻面对照，然后<strong className="font-semibold text-zinc-800 dark:text-zinc-100">如实给自己打分</strong>。
            小M 据此用记忆曲线安排下次复习时间——越熟的卡，间隔越长。
          </p>
          <ul className="space-y-2">
            {RATINGS.map((r) => (
              <li
                key={r.n}
                className="flex items-start gap-3 rounded-card border border-zinc-200/80 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <span
                  className={cn(
                    'flex h-8 min-w-[3.5rem] items-center justify-center gap-1.5 rounded-field border px-2 text-sm font-semibold',
                    r.cls
                  )}
                >
                  <span className="tabular-nums opacity-60">{r.n}</span>
                  {r.label}
                </span>
                <p className="mt-0.5 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">
                  {r.meaning}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px] leading-relaxed text-zinc-400">
            桌面端可用键盘：<Kbd>空格</Kbd> 翻面，<Kbd>1</Kbd>–<Kbd>4</Kbd> 评分。今天不想复习？点底部「全部跳过今天」，不计错、明天再来。
          </p>
        </section>

        {/* 4. 问小M + 知识库 */}
        <section>
          <GuideHeading Icon={AskIcon} title="四、问小M 与知识库" />
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Card className="h-full">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/10 text-brand">
                <AskIcon aria-hidden className="h-[18px] w-[18px]" />
              </span>
              <p className="mt-2.5 text-sm font-semibold text-zinc-800 dark:text-zinc-100">问小M</p>
              <p className="mt-1 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                用自己的话提问，比如「我记过哪些关于专注力的内容？」小M 只基于你记录并整理过的内容作答，并标注来源；库里没有的会如实说不知道，不编造。
              </p>
            </Card>
            <Card className="h-full">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/10 text-brand">
                <LibraryIcon aria-hidden className="h-[18px] w-[18px]" />
              </span>
              <p className="mt-2.5 text-sm font-semibold text-zinc-800 dark:text-zinc-100">知识库</p>
              <p className="mt-1 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                整理后的概念都在这里，可按「领域 › 主题」下钻、一屏俯瞰，或看概念关系图谱。顶部搜索框支持关键词、标签与语义检索。
              </p>
            </Card>
          </div>
        </section>

        {/* 行动召唤 */}
        <section className="rounded-card border border-brand/15 bg-gradient-to-br from-brand/[0.06] to-transparent p-5 text-center dark:border-brand/20 dark:from-brand/[0.1]">
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">准备好了吗？</p>
          <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            最好的开始就是记下第一条。哪怕只是一句此刻的想法。
          </p>
          <Link
            href="/"
            className="mt-3.5 inline-flex items-center justify-center gap-2 rounded-field bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-card transition duration-150 ease-smooth hover:bg-brand-dark hover:shadow-card-hover active:scale-[0.98]"
          >
            <TextIcon aria-hidden className="h-4 w-4" />
            去记录
          </Link>
        </section>
      </div>
    </PageShell>
  );
}

/** 区块标题：图标 + 标题，统一节奏。 */
function GuideHeading({ Icon, title }: { Icon: LucideIcon; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/10 text-brand">
        <Icon aria-hidden className="h-[18px] w-[18px]" />
      </span>
      <h2 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{title}</h2>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand/50" />
      <span>{children}</span>
    </li>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
      {children}
    </kbd>
  );
}
