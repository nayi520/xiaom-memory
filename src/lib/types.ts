export type NoteType = 'text' | 'voice' | 'link' | 'image';
export type NoteStatus = 'inbox' | 'processed' | 'needs_review' | 'archived';

export interface Note {
  id: string;
  user_id: string;
  type: NoteType;
  raw_content: string | null;
  transcript: string | null;
  url: string | null;
  media_path: string | null;
  why_important: string | null;
  status: NoteStatus;
  /** AI 整理生成的摘要（阶段 2） */
  summary?: string | null;
  created_at: string;
}
