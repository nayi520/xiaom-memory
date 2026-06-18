'use client';

/**
 * 问答答案渲染：Markdown + 可点击 [n] 角标引用（V9）。
 *
 * 与通用 ui/Markdown 同一套 Tailwind 元素样式（深浅色自适应、无 raw HTML、防 XSS）+ remark-gfm
 *（表格 / 任务清单 / 删除线 / 裸链接），额外在所有文本叶子里把 `[n]`（n 为数字）替换为可点击角标：
 * 点击触发 onCite(n)，由上层滚动/跳转到对应来源概念。流式途中可反复重渲染（每帧追加 token 后重绘）。
 */

import { Fragment, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/components/ui';

/** 把一段纯文本里的 [n] 拆成「文本 + 可点击角标」节点；非 [n] 原样返回。 */
function linkifyText(text: string, onCite?: (n: number) => void): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /\[(\d{1,3})\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const n = Number(m[1]);
    parts.push(
      <button
        key={`cite-${key++}`}
        type="button"
        onClick={() => onCite?.(n)}
        title={`查看来源 ${n}`}
        aria-label={`查看来源 ${n}`}
        className="mx-0.5 inline-flex items-center rounded bg-brand/10 px-1 align-baseline text-[0.72em] font-bold leading-tight tabular-nums text-brand transition hover:bg-brand/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
      >
        {n}
      </button>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** 递归处理 react-markdown 的 children：仅替换字符串叶子里的 [n]，元素节点透传。 */
function linkifyChildren(children: ReactNode, onCite?: (n: number) => void): ReactNode {
  if (typeof children === 'string') {
    return linkifyText(children, onCite).map((node, i) => (
      <Fragment key={i}>{node}</Fragment>
    ));
  }
  if (Array.isArray(children)) {
    return children.map((c, i) => (
      <Fragment key={i}>{linkifyChildren(c, onCite)}</Fragment>
    ));
  }
  return children;
}

function makeComponents(onCite?: (n: number) => void): Components {
  const L = (children: ReactNode) => linkifyChildren(children, onCite);
  return {
    p: ({ children }) => (
      <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{L(children)}</p>
    ),
    a: ({ children, href }) => (
      <a
        href={href}
        target="_blank"
        rel="noreferrer nofollow"
        className="text-brand underline underline-offset-2 transition hover:text-brand-dark"
      >
        {L(children)}
      </a>
    ),
    strong: ({ children }) => (
      <strong className="font-semibold text-zinc-900 dark:text-zinc-50">{L(children)}</strong>
    ),
    em: ({ children }) => <em className="italic">{L(children)}</em>,
    h1: ({ children }) => (
      <h1 className="mb-2 mt-4 text-lg font-bold leading-snug first:mt-0">{L(children)}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="mb-2 mt-4 text-base font-bold leading-snug first:mt-0">{L(children)}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="mb-1.5 mt-3 text-sm font-semibold leading-snug first:mt-0">{L(children)}</h3>
    ),
    h4: ({ children }) => (
      <h4 className="mb-1.5 mt-3 text-sm font-semibold leading-snug first:mt-0">{L(children)}</h4>
    ),
    ul: ({ children }) => (
      <ul className="my-2 ml-5 list-disc space-y-1 marker:text-zinc-400">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="my-2 ml-5 list-decimal space-y-1 marker:text-zinc-400">{children}</ol>
    ),
    li: ({ children, className }) => {
      const isTask = (className ?? '').includes('task-list-item');
      return (
        <li className={cn('leading-relaxed', isTask && 'flex list-none items-start gap-2 -ml-5')}>
          {L(children)}
        </li>
      );
    },
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
      <del className="text-zinc-400 line-through dark:text-zinc-500">{L(children)}</del>
    ),
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
        {L(children)}
      </th>
    ),
    td: ({ children }) => (
      <td className="px-3 py-2 align-top text-zinc-600 dark:text-zinc-300">{L(children)}</td>
    ),
    blockquote: ({ children }) => (
      <blockquote className="my-2 border-l-2 border-zinc-300 pl-3 italic text-zinc-500 dark:border-zinc-600 dark:text-zinc-400">
        {children}
      </blockquote>
    ),
    code: ({ className, children }) => {
      const isBlock = /language-/.test(className ?? '');
      if (isBlock) {
        return <code className={cn('font-mono text-[0.85em]', className)}>{children}</code>;
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
}

export default function AnswerMarkdown({
  content,
  onCite,
  className,
}: {
  content: string | null | undefined;
  onCite?: (n: number) => void;
  className?: string;
}) {
  const text = (content ?? '').trim();
  if (!text) return null;
  return (
    <div className={cn('break-words text-zinc-800 dark:text-zinc-100', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={makeComponents(onCite)}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
