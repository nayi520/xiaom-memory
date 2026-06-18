'use client';

/**
 * 批量操作编排（V20）——把「并发执行 + 进度/失败计数 + 结果 Toast + 撤销」串成一处，
 * 供最近记录 / 时间线 / 回收站三个列表共用，避免各自重复实现。
 *
 * 调用方提供：
 *  - ids：要处理的记录 id；
 *  - run(id)：单条正向操作（复用 noteBatchActions，如 trashNote）；
 *  - 可选 undo：{ run(id) 反向操作, verb 文案 }——提供则结果 Toast 带「撤销」按钮，
 *    点击对成功项执行反向操作（best-effort），并回调 onUndoUI 让列表把它们放回去。
 *  - 文案：doing（执行中）/ done（完成动词，如「删除」「恢复」「打标签」）。
 *  - onItemSettled?(id, ok)：每条落定回调（列表据此把失败项放回/标记）。
 *
 * 破坏性操作的「撤销」走反向既有接口（trash↔restore），不依赖新端点；永久删除不提供撤销。
 */

import { useCallback, useRef, useState } from 'react';
import { useToast } from '@/components/ui';
import { runBatch } from './runBatch';

export interface NoteBatchUndo {
  /** 单条反向操作（如 restoreNote）。 */
  run: (id: string) => Promise<void>;
  /** 撤销时把成功项放回 UI（乐观复原）。 */
  onUndoUI?: (ids: string[]) => void;
}

export interface RunNoteBatchArgs {
  ids: string[];
  run: (id: string) => Promise<void>;
  /** 完成动词，用于结果文案：如「删除」「恢复」「打标签」「永久删除」。 */
  verb: string;
  /** 可选撤销配置（破坏性可逆操作传入）。 */
  undo?: NoteBatchUndo;
  /** 每条落定回调（id, 是否成功）。 */
  onItemSettled?: (id: string, ok: boolean) => void;
}

export interface NoteBatchController {
  /** 是否正在执行批量。 */
  busy: boolean;
  /** 进度（done/total），busy 时有效。 */
  progress: { done: number; total: number } | null;
  /** 执行一次批量操作。 */
  run: (args: RunNoteBatchArgs) => Promise<void>;
}

export function useNoteBatch(): NoteBatchController {
  const { toast, success, error: toastError, info } = useToast();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // 防重入：一次批量未结束前忽略新触发。
  const running = useRef(false);

  const run = useCallback(
    async ({ ids, run: runOne, verb, undo, onItemSettled }: RunNoteBatchArgs) => {
      if (running.current || ids.length === 0) return;
      running.current = true;
      setBusy(true);
      setProgress({ done: 0, total: ids.length });

      const summary = await runBatch(ids, (id) => runOne(id), {
        concurrency: 4,
        onProgress: (done, total) => setProgress({ done, total }),
      });

      // 逐条回调落定（成功/失败），供列表把失败项放回。
      if (onItemSettled) {
        for (const r of summary.results) onItemSettled(r.item, r.ok);
      }

      setBusy(false);
      setProgress(null);
      running.current = false;

      const okIds = summary.results.filter((r) => r.ok).map((r) => r.item);

      // 全失败：纯错误提示，不给撤销。
      if (summary.succeeded === 0) {
        toastError(`${verb}失败（${summary.failed} 条）`);
        return;
      }

      // 结果文案 + 失败计数（部分失败也照实说）。
      const base =
        summary.failed > 0
          ? `已${verb} ${summary.succeeded} 条，${summary.failed} 条失败`
          : `已${verb} ${summary.succeeded} 条`;

      if (undo && okIds.length > 0) {
        // 可撤销：成功项给「撤销」（反向操作 + UI 复原）。
        toast(base, {
          variant: 'success',
          action: {
            label: '撤销',
            onClick: async () => {
              const back = await runBatch(okIds, (id) => undo.run(id), { concurrency: 4 });
              const restored = back.results.filter((r) => r.ok).map((r) => r.item);
              if (restored.length > 0) undo.onUndoUI?.(restored);
              if (back.failed > 0) {
                toastError(`撤销时 ${back.failed} 条失败`);
              } else {
                info('已撤销');
              }
            },
          },
        });
      } else if (summary.failed > 0) {
        toast(base, { variant: 'success' });
      } else {
        success(base);
      }
    },
    [toast, success, toastError, info]
  );

  return { busy, progress, run };
}
