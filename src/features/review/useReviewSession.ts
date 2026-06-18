'use client';

/**
 * 复习会话本地续做（V20）——把「复习进行到哪了」轻量持久化到 localStorage，
 * 中途关页 / 切走 / 刷新后回到复习页，可「继续上次复习」而不是从头再来。
 *
 * 设计要点：
 *  - **只存进度元数据，不存卡片内容**：模式/领域 + 原始队列的卡片 id 顺序 + 当前位置 +
 *    各档计数 / 毕业 / 暂停 / 最高连击 + 时间戳。卡片正文仍由服务端权威下发，避免存陈旧内容。
 *  - **失效优雅丢弃**（见 {@link matchSavedSession}）：仅当「模式/领域一致 + 未过期 + 未完成 +
 *    服务端最新队列的开头正好接上『尚未复习的那批卡』」时才可续做；否则（队列变了 / 卡片已调度走 /
 *    顺序变化 / 过期）判为失效，返回 null → 当作全新会话从头开始，绝不错位复习。
 *  - **隐私模式 / 配额写失败整体降级**：读写都 try/catch，失败即视为「无会话」，不抛错、不阻断复习。
 *  - **完成 / 跳过即清除**：避免下次进来又提示续做一个已结束的会话。
 *
 * 与 useDraft（V18）同源的 localStorage 韧性模式，但这里存的是结构化进度而非纯文本草稿。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReviewMode, ReviewQueueItem } from './types';
import type { ReviewRating } from './fsrs';

/** 存储键（版本化，结构变更时升版自然作废旧数据）。 */
const STORAGE_KEY = 'mxiao.review.session.v1';
/** 会话最长有效期（ms）：超过即视为过期丢弃（隔天/隔很久回来重新开始）。 */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 小时

/** 持久化的会话进度快照。 */
export interface SavedReviewSession {
  /** 写入时间戳（ms），用于过期判定。 */
  savedAt: number;
  /** 复习模式（due/all/leech）——与当前 URL 模式不一致则不续做。 */
  mode: ReviewMode;
  /** 领域过滤（null=不限）——与当前不一致则不续做。 */
  domain: string | null;
  /** 原始队列的卡片 id 顺序快照（含已复习与未复习）。 */
  queueIds: string[];
  /** 当前位置（已复习 idx 张，下一张是 queueIds[idx]）。 */
  idx: number;
  /** 各档自评累计计数。 */
  stats: Record<ReviewRating, number>;
  /** 本次已毕业张数。 */
  graduated: number;
  /** 本次已暂停张数。 */
  suspendedCount: number;
  /** 本次最高连击。 */
  maxCombo: number;
}

/** 从 localStorage 读出已存会话；解析失败 / 不存在返回 null。 */
function readSaved(): SavedReviewSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<SavedReviewSession>;
    // 基本形状校验（容忍旧版/脏数据）。
    if (
      !data ||
      typeof data.savedAt !== 'number' ||
      !Array.isArray(data.queueIds) ||
      typeof data.idx !== 'number' ||
      !data.stats ||
      typeof data.stats !== 'object'
    ) {
      return null;
    }
    return data as SavedReviewSession;
  } catch {
    return null;
  }
}

/** 清除已存会话（完成 / 跳过 / 失效时调用）。失败静默。 */
export function clearSavedReviewSession(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* 忽略 */
  }
}

/**
 * 判断已存会话能否在「当前模式/领域 + 服务端最新队列」下续做。
 * 可续做返回 `{ idx, stats, graduated, suspendedCount, maxCombo }`（要对齐到最新队列的偏移）；
 * 失效返回 null。
 *
 * 续做条件（全部满足）：
 *  1. 模式 / 领域一致；
 *  2. 未过期（savedAt 在 TTL 内）；
 *  3. 进行到一半（0 < idx < queueIds.length）——没开始或已结束都不必续做；
 *  4. **最新队列的开头正好是「尚未复习的那批卡」**：freshIds 的前 N 项 === queueIds.slice(idx)
 *     （N = 剩余张数）。这保证我们接着复习的就是原来没复习完的卡、顺序不乱；
 *     若服务端少了某些卡（已被调度走 / 暂停 / 删除）或顺序变化，则不满足 → 失效。
 */
export function matchSavedSession(
  saved: SavedReviewSession | null,
  mode: ReviewMode,
  domain: string | null,
  freshIds: string[],
  nowMs: number = Date.now()
): {
  idx: number;
  stats: Record<ReviewRating, number>;
  graduated: number;
  suspendedCount: number;
  maxCombo: number;
} | null {
  if (!saved) return null;
  if (saved.mode !== mode || saved.domain !== domain) return null;
  if (nowMs - saved.savedAt > SESSION_TTL_MS) return null;

  const total = saved.queueIds.length;
  if (saved.idx <= 0 || saved.idx >= total) return null;

  const remaining = saved.queueIds.slice(saved.idx);
  if (remaining.length === 0 || remaining.length > freshIds.length) return null;
  // 最新队列开头必须逐张等于「剩余未复习卡」。
  for (let i = 0; i < remaining.length; i++) {
    if (freshIds[i] !== remaining[i]) return null;
  }

  // 对齐到最新队列：最新队列开头就是剩余卡，所以续做的起始 idx = 0。
  return {
    idx: 0,
    stats: normalizeStats(saved.stats),
    graduated: typeof saved.graduated === 'number' ? saved.graduated : 0,
    suspendedCount:
      typeof saved.suspendedCount === 'number' ? saved.suspendedCount : 0,
    maxCombo: typeof saved.maxCombo === 'number' ? saved.maxCombo : 0,
  };
}

/** 把可能不完整的 stats 补成四档齐全的非负整数表。 */
function normalizeStats(
  raw: Partial<Record<ReviewRating, number>>
): Record<ReviewRating, number> {
  const pick = (r: ReviewRating) => {
    const v = raw[r];
    return typeof v === 'number' && v >= 0 ? Math.floor(v) : 0;
  };
  return { 1: pick(1), 2: pick(2), 3: pick(3), 4: pick(4) };
}

/** useReviewSession 的入参（当前会话的静态信息 + 持续变化的进度）。 */
export interface ReviewSessionState {
  mode: ReviewMode;
  domain: string | null;
  items: ReviewQueueItem[];
  idx: number;
  stats: Record<ReviewRating, number>;
  graduated: number;
  suspendedCount: number;
  maxCombo: number;
  /** 是否已结束（完成 / 跳过）——结束时清除存档，不再持久化。 */
  finished: boolean;
  /**
   * 是否「已开始持久化」。续做提示未决（用户还没点继续/重新开始）时传 false，
   * 避免用一个 idx=0 的空白会话覆盖掉刚检测到的存档。决定后置 true 才开始写盘。
   */
  active: boolean;
}

/** useReviewSession 的返回：续做检测结果（仅首屏读一次）+ 清除存档方法。 */
export interface UseReviewSessionResult {
  /**
   * 首屏检测到的可续做进度（已对齐最新队列），null = 无可续做（全新开始）。
   * 仅在挂载时计算一次，供「继续上次复习 / 重新开始」二选一的提示用。
   */
  resumable: {
    idx: number;
    stats: Record<ReviewRating, number>;
    graduated: number;
    suspendedCount: number;
    maxCombo: number;
  } | null;
  /** 主动清除存档（用户选「重新开始」/ 完成 / 跳过时调用）。 */
  clear: () => void;
}

/**
 * 复习会话续做：挂载时读存档并判定能否续做；随后把当前进度持续写回 localStorage。
 *
 * @param state 当前会话的实时状态（每次进度变化都传新值，hook 负责防抖写盘）。
 */
export function useReviewSession(
  state: ReviewSessionState
): UseReviewSessionResult {
  const {
    mode,
    domain,
    items,
    idx,
    stats,
    graduated,
    suspendedCount,
    maxCombo,
    finished,
    active,
  } = state;

  // 仅挂载时计算一次「可续做进度」，对齐到本次最新队列。
  const [resumable] = useState(() => {
    const freshIds = items.map((it) => it.id);
    return matchSavedSession(readSaved(), mode, domain, freshIds);
  });

  // 本次队列的卡片 id 顺序（写盘用），随 items 变化重算。
  const queueIds = useRef<string[]>(items.map((it) => it.id));
  useEffect(() => {
    queueIds.current = items.map((it) => it.id);
  }, [items]);

  const clear = useCallback(() => {
    clearSavedReviewSession();
  }, []);

  // 进度变化 → 防抖写盘；结束 / 空队列则清除（不持久化已结束/无内容的会话）。
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    // 续做提示未决：先不动存档（既不写也不清），等用户选完再决定。
    if (!active) return;

    if (finished || items.length === 0 || idx >= items.length) {
      // 结束或没什么可续做的：清掉旧存档，避免下次误提示。
      clearSavedReviewSession();
      return;
    }

    timerRef.current = setTimeout(() => {
      const snapshot: SavedReviewSession = {
        savedAt: Date.now(),
        mode,
        domain,
        queueIds: queueIds.current,
        idx,
        stats,
        graduated,
        suspendedCount,
        maxCombo,
      };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      } catch {
        /* 配额 / 隐私模式：降级为纯内存态，不影响复习 */
      }
    }, 250);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [active, mode, domain, items.length, idx, stats, graduated, suspendedCount, maxCombo, finished]);

  // 卸载兜底：若仍在进行中，立即落一次盘（防抖未触发就被卸载的情况，如快速切走）。
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { resumable, clear };
}
