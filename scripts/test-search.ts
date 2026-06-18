/**
 * 知识库搜索合并去重逻辑验证（纯函数，不依赖数据库 / API）
 *
 * 运行：pnpm test:search   （= tsx scripts/test-search.ts）
 *
 * 覆盖：
 * 1. 同一概念被关键词 + 语义同时命中 → 去重为一条，来源并集
 * 2. 同一记录被关键词 + 标签同时命中 → 去重，snippet 取首个非空
 * 3. 排序：来源数多 > 语义相似度高 > 时间新
 * 4. 相似度取多路最大值
 * 5. 空输入 → 空输出
 * 6. escapeIlike 转义 % _ \
 */

import {
  mergeHits,
  escapeIlike,
  normalizeMode,
  tokenizeQuery,
  splitByTerms,
  type RawHit,
} from '../src/features/library/search';

let failed = 0;

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    console.error(`  ❌ ${name}${detail ? `\n     ${detail}` : ''}`);
  }
}

function hit(partial: Partial<RawHit> & { id: string }): RawHit {
  return {
    kind: 'concept',
    title: `t-${partial.id}`,
    snippet: '',
    created_at: '2026-06-01T00:00:00Z',
    ...partial,
  };
}

// ---- 1. 关键词 + 语义同命中 → 去重、来源并集 ----
console.log('1. 概念被关键词与语义同时命中');
{
  const merged = mergeHits([
    { source: 'keyword', hits: [hit({ id: 'c1' })] },
    { source: 'semantic', hits: [hit({ id: 'c1', similarity: 0.6 })] },
  ]);
  assert(merged.length === 1, '去重为 1 条', `实际 ${merged.length}`);
  assert(
    merged[0].sources.join(',') === 'keyword,semantic',
    '来源为 keyword+semantic',
    merged[0].sources.join(',')
  );
  assert(merged[0].similarity === 0.6, '保留语义相似度');
}

// ---- 2. 记录被关键词 + 标签命中，snippet 取首个非空 ----
console.log('2. 记录被关键词与标签同时命中');
{
  const merged = mergeHits([
    { source: 'keyword', hits: [hit({ id: 'n1', kind: 'note', snippet: '' })] },
    { source: 'tag', hits: [hit({ id: 'n1', kind: 'note', snippet: '💡 标签里的摘要' })] },
  ]);
  assert(merged.length === 1, '去重为 1 条');
  assert(merged[0].sources.length === 2, '来源 2 个');
  assert(merged[0].snippet === '💡 标签里的摘要', 'snippet 补全为非空值');
}

// ---- 3. 排序规则 ----
console.log('3. 排序：来源数 > 相似度 > 时间');
{
  const merged = mergeHits([
    {
      source: 'keyword',
      hits: [
        hit({ id: 'both', created_at: '2026-01-01T00:00:00Z' }),
        hit({ id: 'kw-new', created_at: '2026-06-09T00:00:00Z' }),
        hit({ id: 'kw-old', created_at: '2026-06-01T00:00:00Z' }),
      ],
    },
    {
      source: 'semantic',
      hits: [
        hit({ id: 'both', similarity: 0.4, created_at: '2026-01-01T00:00:00Z' }),
        hit({ id: 'sem-high', similarity: 0.9, created_at: '2026-02-01T00:00:00Z' }),
      ],
    },
  ]);
  const order = merged.map((h) => h.id).join(' > ');
  assert(merged[0].id === 'both', '双来源最优先', order);
  assert(merged[1].id === 'sem-high', '其后按相似度', order);
  assert(
    merged[2].id === 'kw-new' && merged[3].id === 'kw-old',
    '无相似度的按时间新旧',
    order
  );
}

// ---- 4. 相似度取最大值 ----
console.log('4. 多路相似度取最大');
{
  const merged = mergeHits([
    { source: 'semantic', hits: [hit({ id: 'c1', similarity: 0.4 })] },
    { source: 'semantic', hits: [hit({ id: 'c1', similarity: 0.7 })] },
  ]);
  assert(merged[0].similarity === 0.7, 'similarity = 0.7');
  assert(merged[0].sources.length === 1, '同来源不重复');
}

// ---- 5. 空输入 ----
console.log('5. 空输入');
{
  const merged = mergeHits([
    { source: 'keyword', hits: [] },
    { source: 'tag', hits: [] },
    { source: 'semantic', hits: [] },
  ]);
  assert(merged.length === 0, '空结果');
}

// ---- 6. escapeIlike ----
console.log('6. ILIKE 转义');
{
  assert(escapeIlike('100%_\\a') === '100\\%\\_\\\\a', '% _ \\ 均被转义', escapeIlike('100%_\\a'));
  assert(escapeIlike('拖延') === '拖延', '普通中文不变');
}

// ---- 7. normalizeMode（V8 混合检索：向后兼容） ----
console.log('7. 检索模式归一化');
{
  assert(normalizeMode('keyword') === 'keyword', 'keyword 透传');
  assert(normalizeMode('semantic') === 'semantic', 'semantic 透传');
  assert(normalizeMode('hybrid') === 'hybrid', 'hybrid 透传');
  // 未传 / 非法值 → 默认 hybrid（旧调用不带 mode 仍走混合检索）。
  assert(normalizeMode(null) === 'hybrid', 'null → hybrid');
  assert(normalizeMode(undefined) === 'hybrid', 'undefined → hybrid');
  assert(normalizeMode('bogus') === 'hybrid', '非法值 → hybrid');
}

// ---- 8. tokenizeQuery（V22 高亮分词：去空/去重/长词优先） ----
console.log('8. 查询分词');
{
  assert(tokenizeQuery('  拖延  ').join('|') === '拖延', '去首尾空白', tokenizeQuery('  拖延  ').join('|'));
  assert(
    tokenizeQuery('foo bar foo').join('|') === 'foo|bar',
    '去重 + 同长保持出现序（稳定排序）',
    tokenizeQuery('foo bar foo').join('|')
  );
  assert(
    tokenizeQuery('a abc ab').join('|') === 'abc|ab|a',
    '长词优先（abc > ab > a）',
    tokenizeQuery('a abc ab').join('|')
  );
  assert(tokenizeQuery('').length === 0, '空串 → 无词');
}

// ---- 9. splitByTerms（V22 高亮分片：大小写不敏感、命中标记、长词优先不被短词截断） ----
console.log('9. 命中词分片');
{
  // 基本命中：把「延」高亮出来。
  const segs = splitByTerms('拖延症', '延');
  assert(segs.length === 3, '切成 前/命中/后 三段', JSON.stringify(segs));
  assert(segs[1].text === '延' && segs[1].match === true, '中段为命中');
  assert(segs[0].match === false && segs[2].match === false, '两侧非命中');

  // 大小写不敏感。
  const ci = splitByTerms('Hello World', 'hello');
  assert(ci[0].text === 'Hello' && ci[0].match === true, '大小写不敏感命中', JSON.stringify(ci));

  // 多词：两词都高亮。
  const multi = splitByTerms('深度工作与心流', '深度 心流');
  const marked = multi.filter((s) => s.match).map((s) => s.text).join(',');
  assert(marked === '深度,心流', '多词各自高亮', marked);

  // 长词优先：'ab' 整体命中，不被 'a' 先吃掉。
  const longest = splitByTerms('abc', 'a ab');
  const lmarked = longest.filter((s) => s.match).map((s) => s.text).join(',');
  assert(lmarked === 'ab', '长词优先匹配（ab 而非 a）', lmarked);

  // 无命中 / 无词 / 空文本：返回整段或空。
  assert(splitByTerms('无关文本', 'xyz').length === 1, '无命中 → 单段原文');
  assert(splitByTerms('文本', '   ').length === 1, '空查询 → 单段原文');
  assert(splitByTerms('', 'q').length === 0, '空文本 → 空数组');

  // 正则元字符不应当作模式：括号查询词按字面匹配。
  const special = splitByTerms('成本(C)很高', '(C)');
  const smarked = special.filter((s) => s.match).map((s) => s.text).join(',');
  assert(smarked === '(C)', '正则元字符按字面命中', smarked);
}

// ---- 汇总 ----
if (failed > 0) {
  console.error(`\n❌ ${failed} 项断言失败`);
  process.exit(1);
}
console.log('\n✅ 搜索合并去重逻辑全部通过');
