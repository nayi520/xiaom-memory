import type { Note } from '@/lib/types';

/** 最近记录列表项：支持乐观 UI 状态 */
export type RecentItem = Note & {
  pending?: boolean;
  failed?: boolean;
  hint?: string; // 如"转写中…"、"转写待配置"
};

export type CaptureTab = 'text' | 'voice' | 'link';

/** CapturePage 提供给三个录入组件的回调 */
export interface CaptureHandlers {
  addOptimistic: (item: RecentItem) => void;
  confirmNote: (tempId: string, note: Note, hint?: string) => void;
  updateNote: (id: string, patch: Partial<RecentItem>) => void;
  failNote: (tempId: string, message?: string) => void;
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
