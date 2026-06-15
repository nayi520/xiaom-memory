import type { Note } from '@/lib/types';

/** 最近记录列表项：支持乐观 UI 状态 */
export type RecentItem = Note & {
  pending?: boolean;
  failed?: boolean;
  /** 离线入队、待联网同步（与 pending「正在提交」区分；展示「待同步」徽标）。 */
  queued?: boolean;
  hint?: string; // 如"转写中…"、"转写待配置"
  /** 失败时由录入组件挂上的重试回调（点「重试」再发一次同一请求）。 */
  retry?: () => void;
};

export type CaptureTab = 'text' | 'voice' | 'link';

/** CapturePage 提供给三个录入组件的回调 */
export interface CaptureHandlers {
  addOptimistic: (item: RecentItem) => void;
  confirmNote: (tempId: string, note: Note, hint?: string) => void;
  updateNote: (id: string, patch: Partial<RecentItem>) => void;
  /** 标记失败；可选 retry 回调挂到该条上，供「重试」按钮调用。 */
  failNote: (tempId: string, message?: string, retry?: () => void) => void;
  /** 标记为「已离线入队、待同步」（联网后由后台自动同步）。 */
  queueNote: (tempId: string) => void;
}

/** 构造乐观 UI 占位 note */
export function makeTempNote(partial: Partial<RecentItem>): RecentItem {
  return {
    id: `temp-${crypto.randomUUID()}`,
    user_id: '',
    type: 'text',
    raw_content: null,
    transcript: null,
    url: null,
    media_path: null,
    why_important: null,
    status: 'inbox',
    created_at: new Date().toISOString(),
    pending: true,
    ...partial,
  };
}
