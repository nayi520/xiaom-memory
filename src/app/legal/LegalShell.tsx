/**
 * 法务页通用外壳（用户协议 / 隐私政策共用）—— 注册门禁加固
 *
 * 纯展示、无鉴权依赖（路径已在 middleware PUBLIC_PATHS）。居中单列、可读排版，
 * 顶部返回登录，底部互链另一份法务文档。服务端组件，零客户端 JS。
 */

import Link from 'next/link';
import SiteFooter from '@/components/ui/SiteFooter';

export interface LegalSection {
  heading: string;
  /** 段落数组：每个元素渲染为一个 <p>；列表项以 '- ' 开头时归并为 <ul>。 */
  paragraphs: string[];
}

export default function LegalShell({
  title,
  updated,
  intro,
  sections,
  otherHref,
  otherLabel,
}: {
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
  otherHref: string;
  otherLabel: string;
}) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-6 py-12">
      <nav className="mb-8 flex items-center justify-between text-sm">
        <Link
          href="/login"
          className="text-zinc-500 transition hover:text-brand dark:text-zinc-400"
        >
          ← 返回登录
        </Link>
        <Link
          href={otherHref}
          className="text-zinc-500 transition hover:text-brand dark:text-zinc-400"
        >
          {otherLabel}
        </Link>
      </nav>

      <header className="mb-8 border-b border-zinc-200 pb-6 dark:border-zinc-800">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          {title}
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{updated}</p>
        {/* 合规提示：本文为通用模板，正式对外运营前须经法务复核。 */}
        <p className="mt-4 rounded-field border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          本文为通用模板，<strong>正式对外运营前请经法务复核</strong>。当前小M 仅在小范围内私密使用。
        </p>
      </header>

      <article className="space-y-7 text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300">
        <p>{intro}</p>
        {sections.map((sec, i) => (
          <section key={i}>
            <h2 className="mb-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {`${i + 1}. ${sec.heading}`}
            </h2>
            <LegalBody paragraphs={sec.paragraphs} />
          </section>
        ))}
      </article>

      <div className="mt-12 space-y-5 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <p className="text-xs text-zinc-400 dark:text-zinc-600">
          如对本文档有疑问，请通过应用内反馈或邮件联系我们。
        </p>
        {/* 合规页脚：版权 + 法务互链 + ICP 备案号。 */}
        <SiteFooter />
      </div>
    </main>
  );
}

/** 把段落数组渲染为 <p> 与 <ul>（连续的 '- ' 行归并成一个列表）。 */
function LegalBody({ paragraphs }: { paragraphs: string[] }) {
  const blocks: React.ReactNode[] = [];
  let listBuffer: string[] = [];

  const flushList = (key: string) => {
    if (listBuffer.length === 0) return;
    blocks.push(
      <ul key={key} className="ml-5 list-disc space-y-1.5">
        {listBuffer.map((item, idx) => (
          <li key={idx}>{item.replace(/^-\s*/, '')}</li>
        ))}
      </ul>
    );
    listBuffer = [];
  };

  paragraphs.forEach((p, idx) => {
    if (p.startsWith('- ')) {
      listBuffer.push(p);
    } else {
      flushList(`ul-${idx}`);
      blocks.push(<p key={`p-${idx}`}>{p}</p>);
    }
  });
  flushList('ul-end');

  return <div className="space-y-3">{blocks}</div>;
}
