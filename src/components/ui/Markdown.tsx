'use client';

/**
 * Markdown 渲染（笔记正文 rawContent / 概念解释 summary 等）。
 *
 * 用 react-markdown + remark-gfm 渲染，默认安全：
 *   - 不启用 raw HTML（不挂 rehype-raw），不使用 dangerouslySetInnerHTML，杜绝 XSS。
 *   - 启用 GFM：表格 / 任务清单（- [ ] / - [x]）/ 删除线 / 裸链接自动识别——
 *     AI 输出（如 P8 语音待办用 `- [ ]`、学习指南/周报偶发表格）才能正确渲染，不再露出原始符号。
 * 样式：项目未装 @tailwindcss/typography（无 prose），逐元素映射 Tailwind 类，
 * 与现有设计（zinc 文本 / brand 链接）对齐，深浅色自适应。
 *
 * 链接安全：外链统一 target=_blank + rel="noreferrer nofollow"。
 */

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
  // GFM 任务清单项（- [ ] / - [x]）：含 checkbox 时去掉 list 圆点、复选框与文字基线对齐。
  li: ({ children, className }) => {
    const isTask = (className ?? '').includes('task-list-item');
    return (
      <li className={cn('leading-relaxed', isTask && 'flex list-none items-start gap-2 -ml-5')}>
        {children}
      </li>
    );
  },
  // 任务清单复选框：只读展示（disabled），用 brand 强调色，禁止误操作。
  input: ({ type, checked }) =>
    type === 'checkbox' ? (
      <input
        type="checkbox"
        checked={!!checked}
        readOnly
        disabled
        className="mt-1 h-3.5 w-3.5 shrink-0 cursor-default rounded border-zinc-300 accent-brand dark:border-zinc-600"
      />
    ) : null,
  del: ({ children }) => (
    <del className="text-zinc-400 line-through dark:text-zinc-500">{children}</del>
  ),
  // GFM 表格：可横向滚动的容器 + 细分隔线，深浅色自适应；表头浅底加粗。
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-zinc-300 dark:border-zinc-600">{children}</thead>
  ),
  tr: ({ children }) => (
    <tr className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="px-3 py-2 text-left font-semibold text-zinc-700 dark:text-zinc-200">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 align-top text-zinc-600 dark:text-zinc-300">{children}</td>
  ),
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
  // 图片：懒加载 + 异步解码（降低长列表/详情页首屏成本）；
  // 给一个浅底占位 + min-height，图未到时不塌缩、到达后平滑淡入，避免布局抖动（CLS）。
  // 有显式 width/height 时透传，让浏览器据此预留尺寸。
  img: ({ src, alt, width, height }) => {
    if (!src) return null;
    const reveal = (el: HTMLImageElement) => {
      el.style.opacity = '1';
      el.style.minHeight = '0';
    };
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={typeof src === 'string' ? src : undefined}
        alt={alt ?? ''}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
        className="my-2.5 h-auto max-w-full rounded-field border border-zinc-200/70 bg-zinc-100 object-contain opacity-0 transition-opacity duration-300 [min-height:6rem] dark:border-zinc-800 dark:bg-zinc-800/60"
        // 兜底缓存命中：若图片在 onLoad 绑定前已 complete，挂载时直接显现，避免一直透明。
        ref={(el) => {
          if (el && el.complete && el.naturalWidth > 0) reveal(el);
        }}
        onLoad={(e) => reveal(e.currentTarget)}
        // 加载失败：去掉占位高度并恢复可见，避免留下一块空白色块。
        onError={(e) => reveal(e.currentTarget)}
      />
    );
  },
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
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
