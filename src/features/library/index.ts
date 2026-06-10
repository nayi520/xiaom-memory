// 阶段 4：知识库（F4.1 + F4.2）
// 领域→主题→概念→记录 四层下钻 / 关键词+标签+语义搜索 / 用户修正（corrections）
export {
  mergeHits,
  runLibrarySearch,
  escapeIlike,
  excerpt,
  HIT_SOURCE_LABELS,
  SEMANTIC_THRESHOLD,
  SEMANTIC_LIMIT,
  KEYWORD_LIMIT,
  type HitSource,
  type RawHit,
  type SearchHit,
  type LibrarySearchResult,
} from './search';
