/** 多选批量操作（V20）：选择态 + 工具栏 + 批量执行器 + 单条原子调用。 */
export { useSelection, type SelectionApi } from './useSelection';
export { useLongPress } from './useLongPress';
export { useNoteBatch, type NoteBatchController } from './useNoteBatch';
export { default as SelectionToolbar } from './SelectionToolbar';
export { default as SelectCheckbox } from './SelectCheckbox';
export { runBatch, type BatchSummary, type BatchItemResult } from './runBatch';
export {
  trashNote,
  restoreNote,
  purgeNote,
  addTagsToNote,
  parseTagsInput,
} from './noteBatchActions';
