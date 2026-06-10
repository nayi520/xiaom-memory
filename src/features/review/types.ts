import type { NoteType } from '@/lib/types';

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

/** 复习队列中的一张卡（已在服务端排好序、裁到每日上限） */
export interface ReviewQueueItem {
  id: string;
  question: string;
  answer: string;
  conceptName: string;
  notes: SourceNote[];
}
