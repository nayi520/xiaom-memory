// 阶段 4：知识库（F4.1 + F4.2）
// 领域→主题→概念→记录 四层下钻 / 关键词+标签+语义搜索 / 用户修正（corrections）
export {
  mergeHits,
  runLibrarySearch,
  escapeIlike,
  excerpt,
  normalizeMode,
  HIT_SOURCE_LABELS,
  SEARCH_MODES,
  SEMANTIC_THRESHOLD,
  SEMANTIC_LIMIT,
  KEYWORD_LIMIT,
  type HitSource,
  type RawHit,
  type SearchHit,
  type SearchMode,
  type LibrarySearchOptions,
  type LibrarySearchResult,
} from './search';

// V8：知识图谱（节点 = 概念，边 = concept_links）
export {
  getLibraryGraph,
  GRAPH_NODE_LIMIT,
  type GraphNode,
  type GraphLink,
  type LibraryGraph,
} from './graph';
