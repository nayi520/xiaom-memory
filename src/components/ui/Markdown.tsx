'use client';

/**
 * Markdown 渲染（笔记正文 rawContent / 概念解释 summary 等）。
 *
 * 用 react-markdown 渲染，默认安全：
 *   - 不启用 raw HTML（不挂 rehype-raw），不使用 dangerouslySetInnerHTML，杜绝 XSS。
 *   - 仅渲染标准 Markdown（标题/列表/引用/代码/链接/强调/表格-GFM 需额外插件，这里不引）。
 * 样式：项目未装 @tailwindcss/typography（无 prose），逐元素映射 Tailwind 类，
 * 与现有设计（zinc 文本 / brand 链接）对齐，深浅色自适应。
 *
 * 链接安全：外链统一 target=_blank + rel="noreferrer nofollow"。
 */

import ReactMarkdown, { type Components } from 'react-markdown';
import { cn } from './cn';

const components: Components = {
  p: ({ children }) => (
    <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{children}</p>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer nofollow"
      className="text-brand underline underline-offset-2 transition hover:text-brand-dark"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-zinc-900 dark:text-zinc-50">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  h1: ({ children }) => (
    <h1 className="mb-2 mt-4 text-lg font-bold leading-snug first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-4 text-base font-bold leading-snug first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1.5 mt-3 text-sm font-semibold leading-snug first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-1.5 mt-3 text-sm font-semibold leading-snug first:mt-0">{children}</h4>
  ),
  ul: ({ children }) => (
    <ul className="my-2 ml-5 list-disc space-y-1 marker:text-zinc-400">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 ml-5 list-decimal space-y-1 marker:text-zinc-400">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-zinc-300 pl-3 italic text-zinc-500 dark:border-zinc-600 dark:text-zinc-400">
      {children}
    </blockquote>
  ),
  code: ({ className, children }) => {
    // 行内 code 无 language-* 类；代码块（由 pre 包裹）的 code 有。
    const isBlock = /language-/.test(className ?? '');
    if (isBlock) {
      return (
        <code className={cn('font-mono text-[0.85em]', className)}>{children}</code>
      );
    }
    return (
      <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.85em] text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-2.5 overflow-x-auto rounded-field bg-zinc-100 p-3 text-sm leading-relaxed dark:bg-zinc-800/80">
      {children}
    </pre>
  ),
  hr: () => <hr className="my-4 border-zinc-200 dark:border-zinc-700" />,
};

/**
 * 渲染一段 Markdown 文本。
 * @param content Markdown 源（null/空串渲染为空，不报错）
 * @param className 外层容器附加类（控制基础字号/颜色）
 */
export default function Markdown({
  content,
  className,
}: {
  content: string | null | undefined;
  className?: string;
}) {
  const text = (content ?? '').trim();
  if (!text) return null;
  return (
    <div className={cn('break-words text-zinc-800 dark:text-zinc-100', className)}>
      <ReactMarkdown components={components}>{text}</ReactMarkdown>
    </div>
  );
}
