/**
 * 导出与分享（V29）对外入口。
 *   - noteToMarkdown / deriveNoteTitle：纯函数，把单条记录组织成干净 Markdown（详情页分享 + 整库导出共用）。
 *   - NoteExportActions：详情页「复制 Markdown / 分享」客户端组件。
 */
export {
  noteToMarkdown,
  deriveNoteTitle,
  type ExportNoteInput,
  type NoteToMarkdownOptions,
} from './noteMarkdown';
export { default as NoteExportActions } from './NoteExportActions';
