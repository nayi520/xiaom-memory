/**
 * 并发受限的批量执行器（V20 多选批量操作）。
 *
 * 批量 = 循环调既有单条接口（不新增批量端点），但限制并发数避免压垮服务端 / 浏览器连接，
 * 并回收每条的成功/失败，供调用方汇报「成功 N、失败 M」与失败明细回滚。
 *
 * 设计：
 *  - 不抛错：单条 fn 抛出即记为失败，不中断其余项（best-effort，部分成功也有意义）。
 *  - 保序回报：results 与输入 items 同序，便于失败项按 id 回滚/高亮。
 *  - onProgress：每完成一条回调一次（done/total），供进度条/计数实时更新。
 *  - 纯逻辑、无 React 依赖，可在任意上下文调用（hook / 事件处理器）。
 */

export interface BatchItemResult<T> {
  item: T;
  ok: boolean;
  /** 失败时的错误（fn 抛出的原始错误）。 */
  error?: unknown;
}

export interface BatchSummary<T> {
  results: BatchItemResult<T>[];
  /** 成功条数。 */
  succeeded: number;
  /** 失败条数。 */
  failed: number;
  /** 失败的输入项（保序），便于回滚/高亮。 */
  failedItems: T[];
}

export interface RunBatchOptions {
  /** 最大并发数（默认 4）。 */
  concurrency?: number;
  /** 每完成一条回调（done=已完成数，total=总数）。 */
  onProgress?: (done: number, total: number) => void;
  /** 中止信号：已发起的不强行打断，但不再调度新项。 */
  signal?: AbortSignal;
}

/** 默认并发上限：兼顾速度与不打满浏览器同源连接数 / 服务端压力。 */
const DEFAULT_CONCURRENCY = 4;

/**
 * 并发受限地对 items 逐条执行 fn，回收成功/失败汇总。
 *
 * @param items 待处理项
 * @param fn 单条处理（async，抛错即记为失败）
 */
export async function runBatch<T>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<void>,
  options: RunBatchOptions = {}
): Promise<BatchSummary<T>> {
  const total = items.length;
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const results: BatchItemResult<T>[] = new Array(total);
  let done = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < total) {
      if (options.signal?.aborted) return;
      const i = cursor++;
      const item = items[i];
      try {
        await fn(item, i);
        results[i] = { item, ok: true };
      } catch (error) {
        results[i] = { item, ok: false, error };
      }
      done += 1;
      options.onProgress?.(done, total);
    }
  }

  // 启动 min(concurrency, total) 个 worker，竞争消费游标。
  const workers = Array.from({ length: Math.min(concurrency, total) }, () => worker());
  await Promise.all(workers);

  const settled = results.filter(Boolean) as BatchItemResult<T>[];
  const failedItems = settled.filter((r) => !r.ok).map((r) => r.item);
  return {
    results: settled,
    succeeded: settled.filter((r) => r.ok).length,
    failed: failedItems.length,
    failedItems,
  };
}
