import type { NoteType } from '@/lib/types';
import type { FsrsStateJson } from './fsrs';

/** 复习卡片的溯源记录（F3.6：原文 / 链接 / 音频） */
export interface SourceNote {
  id: string;
  type: NoteType;
  raw_content: string | null;
  transcript: string | null;
  url: string | null;
  media_path: string | null;
  why_important: string | null;
  created_at: string;
}

/** 复习模式（V14）：due=今日到期 / all=全部 active（cram）/ leech=顽固卡。 */
export type ReviewMode = 'due' | 'all' | 'leech';

/** 复习队列中的一张卡（已在服务端排好序、裁到每日上限） */
export interface ReviewQueueItem {
  id: string;
  question: string;
  answer: string;
  conceptName: string;
  /** 所属概念 id（JSON API 需要，页面渲染不依赖） */
  conceptId: string;
  notes: SourceNote[];
  /** 是否为 leech（顽固卡，lapses ≥ 阈值）—— 复习卡显示徽标、mode=leech 过滤（V14）。 */
  leech: boolean;
  /** 评分前的 fsrs_state 快照（客户端持有，用于会话内「撤销上一次评分」，V14）。 */
  fsrsState: FsrsStateJson | null;
}
