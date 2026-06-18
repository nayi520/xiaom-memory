'use client';

/**
 * 多选批量操作工具栏（V20）——三个列表（最近记录 / 时间线 / 回收站）共用。
 *
 * 形态：进入选择模式后从底部浮出的固定工具栏（桌面 + 移动通用），左侧选中计数 + 全选/退出，
 * 右侧批量操作按钮（打标签 / 删除 / 恢复 / 永久删除，由调用方按场景传入）。
 *  - 移动端：避开全局底栏（safe-area + 底栏高度），按钮命中区放大。
 *  - 「打标签」点开标签输入面板（移动端底部 sheet；桌面端同一 sheet 居中可用），回车/确认提交。
 *  - 批量执行交给调用方（结合 runBatch + 既有接口）；本组件只负责选择态 UI 与触发。
 *
 * 不引入新依赖；复用 BottomSheet / Button / 既有图标与 token。a11y：工具栏 role=toolbar、有 aria-label。
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Button,
  BottomSheet,
  Input,
  CloseIcon,
  TrashIcon,
  RestoreIcon,
  TagIcon,
  CheckIcon,
  cn,
} from '@/components/ui';
import { parseTagsInput } from './noteBatchActions';

export interface SelectionToolbarProps {
  /** 选中数量。 */
  count: number;
  /** 可选总数（用于「全选」判断与展示）。 */
  total?: number;
  /** 是否已全选（决定「全选/取消全选」文案与行为）。 */
  allSelected?: boolean;
  /** 全选 / 取消全选切换。 */
  onToggleSelectAll?: () => void;
  /** 退出选择模式。 */
  onExit: () => void;
  /** 批量打标签（传入解析后的标签数组）。提供则显示「打标签」。 */
  onTag?: (tags: string[]) => void;
  /** 批量删除（软删 / 移入回收站）。提供则显示「删除」。 */
  onTrash?: () => void;
  /** 批量恢复（回收站）。提供则显示「恢复」。 */
  onRestore?: () => void;
  /** 批量永久删除（回收站，危险）。提供则显示「永久删除」。 */
  onPurge?: () => void;
  /** 批量执行中：禁用按钮、显示忙碌。 */
  busy?: boolean;
}

export default function SelectionToolbar({
  count,
  total,
  allSelected,
  onToggleSelectAll,
  onExit,
  onTag,
  onTrash,
  onRestore,
  onPurge,
  busy,
}: SelectionToolbarProps) {
  const [mounted, setMounted] = useState(false);
  // 标签输入面板开关 + 输入值。
  const [tagSheet, setTagSheet] = useState(false);
  const [tagInput, setTagInput] = useState('');

  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  const submitTags = () => {
    const parsed = parseTagsInput(tagInput);
    if (parsed.length === 0) return;
    onTag?.(parsed);
    setTagInput('');
    setTagSheet(false);
  };

  const bar = (
    <div
      role="toolbar"
      aria-label="批量操作"
      className={cn(
        'fixed inset-x-0 z-50 px-3 pb-[max(0.75rem,calc(env(safe-area-inset-bottom)+4.75rem))] lg:pb-4',
        'bottom-0'
      )}
    >
      <div className="glass mx-auto flex max-w-2xl items-center gap-2 rounded-card border border-zinc-200/80 px-3 py-2.5 shadow-pop motion-safe:animate-fade-in-up dark:border-zinc-700/80">
        {/* 退出 */}
        <button
          type="button"
          onClick={onExit}
          aria-label="退出选择"
          className="touch-target flex shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-none dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          <CloseIcon aria-hidden className="h-5 w-5" />
        </button>

        {/* 计数 + 全选 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
            已选 {count}
            {typeof total === 'number' ? ` / ${total}` : ''}
          </span>
          {onToggleSelectAll && typeof total === 'number' && total > 0 && (
            <button
              type="button"
              onClick={onToggleSelectAll}
              className="self-start text-xs font-medium text-brand underline-offset-2 transition hover:underline focus-visible:outline-none"
            >
              {allSelected ? '取消全选' : `全选本页（${total}）`}
            </button>
          )}
        </div>

        {/* 操作按钮（按传入的回调决定显示哪些） */}
        <div className="flex shrink-0 items-center gap-1.5">
          {onTag && (
            <ToolbarButton
              label="打标签"
              icon={<TagIcon aria-hidden className="h-[18px] w-[18px]" />}
              onClick={() => setTagSheet(true)}
              disabled={busy || count === 0}
            />
          )}
          {onRestore && (
            <ToolbarButton
              label="恢复"
              icon={<RestoreIcon aria-hidden className="h-[18px] w-[18px]" />}
              onClick={onRestore}
              disabled={busy || count === 0}
            />
          )}
          {onTrash && (
            <ToolbarButton
              label="删除"
              icon={<TrashIcon aria-hidden className="h-[18px] w-[18px]" />}
              onClick={onTrash}
              disabled={busy || count === 0}
              danger
            />
          )}
          {onPurge && (
            <ToolbarButton
              label="永久删除"
              icon={<TrashIcon aria-hidden className="h-[18px] w-[18px]" />}
              onClick={onPurge}
              disabled={busy || count === 0}
              danger
            />
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {createPortal(bar, document.body)}

      {/* 批量打标签输入（底部 sheet，移动 + 桌面通用）。 */}
      <BottomSheet
        open={tagSheet}
        onClose={() => setTagSheet(false)}
        title={`给选中的 ${count} 条记录加标签`}
      >
        <p className="px-1 pb-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
          标签会追加到每条记录已有标签上，不会覆盖。多个标签用逗号分隔。
        </p>
        <Input
          autoFocus
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submitTags();
            }
          }}
          placeholder="例如：工作，灵感，待办"
          className="mb-3 px-3 py-2.5 text-sm"
        />
        <div className="space-y-2 pb-2">
          <Button
            size="lg"
            fullWidth
            onClick={submitTags}
            disabled={parseTagsInput(tagInput).length === 0}
          >
            <CheckIcon aria-hidden className="h-4 w-4" />
            添加标签
          </Button>
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            onClick={() => setTagSheet(false)}
          >
            取消
          </Button>
        </div>
      </BottomSheet>
    </>
  );
}

/** 工具栏图标按钮（带文案，大命中区；危险态红色）。 */
function ToolbarButton({
  label,
  icon,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={cn(
        'inline-flex min-h-[2.5rem] items-center gap-1.5 rounded-field px-2.5 py-1.5 text-sm font-medium transition active:scale-[0.97] focus-visible:outline-none disabled:opacity-40',
        danger
          ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/60'
          : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800/70'
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
