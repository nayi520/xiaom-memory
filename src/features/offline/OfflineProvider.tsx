'use client';

/**
 * 离线同步上下文（V10）——全局挂一次，负责：
 *  1) 维护在线/离线状态与队列计数快照（pending/failed），供任意组件订阅；
 *  2) 在「恢复网络 / 页面回到前台 / SW 通知」时触发 flushOutbox 同步；
 *  3) 同步成功后弹 Toast 告知「N 条已同步」，并通知页面刷新最近列表（自定义事件）。
 *
 * 设计：纯客户端、低频；不支持 IndexedDB 的环境（SSR/老浏览器）整体空转，
 *   录入组件据 isOfflineQueueSupported 回退为纯在线流，不影响主功能。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useToast } from '@/components/ui';
import {
  flushOutbox,
  getOutboxSnapshot,
  isOfflineQueueSupported,
  subscribeOutbox,
  type OutboxSnapshot,
} from './queue';

/** 同步完成后派发：让最近列表/时间线据此刷新（避免轮询）。 */
export const OUTBOX_SYNCED_EVENT = 'mxiao:outbox-synced';

interface OfflineContextValue {
  online: boolean;
  /** 队列计数（pending 待同步 / failed 失败 / total）。 */
  snapshot: OutboxSnapshot;
  /** 手动触发一次同步（如点「立即同步」）。 */
  sync: () => void;
}

const OfflineContext = createContext<OfflineContextValue>({
  online: true,
  snapshot: { pending: 0, failed: 0, total: 0 },
  sync: () => {},
});

export function useOffline(): OfflineContextValue {
  return useContext(OfflineContext);
}

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const { success } = useToast();
  const [online, setOnline] = useState(true);
  const [snapshot, setSnapshot] = useState<OutboxSnapshot>({
    pending: 0,
    failed: 0,
    total: 0,
  });
  // 同步进行中防重入（与 queue 内单飞锁互补，这里避免无谓并发触发）。
  const syncingRef = useRef(false);

  const refreshSnapshot = useCallback(async () => {
    setSnapshot(await getOutboxSnapshot());
  }, []);

  const sync = useCallback(async () => {
    if (!isOfflineQueueSupported()) return;
    if (syncingRef.current) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    syncingRef.current = true;
    try {
      const synced = await flushOutbox();
      if (synced > 0) {
        success(synced === 1 ? '1 条离线记录已同步' : `${synced} 条离线记录已同步`);
        // 通知列表刷新（最近捕获 / 时间线）。
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(OUTBOX_SYNCED_EVENT, { detail: { synced } }));
        }
      }
    } finally {
      syncingRef.current = false;
      await refreshSnapshot();
    }
  }, [success, refreshSnapshot]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setOnline(navigator.onLine);

    if (!isOfflineQueueSupported()) return;

    // 初始快照 + 队列变更订阅。
    void refreshSnapshot();
    const unsub = subscribeOutbox(setSnapshot);

    const onOnline = () => {
      setOnline(true);
      void sync();
    };
    const onOffline = () => setOnline(false);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void sync();
    };
    // SW Background Sync 触发后会 postMessage，前台据此 flush。
    const onSwMessage = (e: MessageEvent) => {
      if (e.data && e.data.type === 'mxiao-outbox-sync') void sync();
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    navigator.serviceWorker?.addEventListener('message', onSwMessage);

    // 首次挂载若在线，补一次同步（覆盖「上次离线入队后直接关页」）。
    if (navigator.onLine) void sync();

    return () => {
      unsub();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      navigator.serviceWorker?.removeEventListener('message', onSwMessage);
    };
  }, [sync, refreshSnapshot]);

  const value = useMemo<OfflineContextValue>(
    () => ({ online, snapshot, sync }),
    [online, snapshot, sync]
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}
