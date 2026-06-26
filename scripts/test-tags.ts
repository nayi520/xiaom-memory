/**
 * 标签管理纯逻辑验证（V32 标签管理：改名 / 合并 / 删除）
 *
 * 运行：pnpm test:tags   （= tsx scripts/test-tags.ts）
 *
 * 覆盖（纯函数，不依赖数据库 / API）：
 * 1. normalizeTagName：去首尾空白 / 前导# / 折叠内部空白；不改大小写；超长截断；非字符串→空
 * 2. isValidTagName：空 / 超长拒绝；正常放行
 * 3. dedupeIds：去重保序、剔空白/非字符串
 * 4. planTagRename：noop（同名）/ rename（新名空闲）/ merge（撞同名→目标）/ 非法名 / 归一化后撞名
 * 5. planTagMerge：去重剔目标自身 / 归属过滤 / 缺目标 / 目标非本人 / 无有效源 / 正常多源
 * 6. 合并去重语义说明（note_tags PK 去重由 SQL 保证，这里验证「计划层」不重复列源）
 */

import {
  normalizeTagName,
  isValidTagName,
  dedupeIds,
  planTagRename,
  planTagMerge,
  MAX_TAG_LENGTH,
  type ExistingTag,
} from '../src/features/library/tag-ops';

let failed = 0;

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    console.error(`  ❌ ${name}${detail ? `\n     ${detail}` : ''}`);
  }
}

// ---- 1. normalizeTagName ----
console.log('1. normalizeTagName 归一化');
{
  assert(normalizeTagName('  心理学  ') === '心理学', '去首尾空白');
  assert(normalizeTagName('#决策偏差') === '决策偏差', '去单个前导 #');
  assert(normalizeTagName('##双井号') === '双井号', '去多个前导 #');
  assert(normalizeTagName('# 带空格井号') === '带空格井号', '# 后空白也去掉');
  assert(normalizeTagName('深度  工作') === '深度 工作', '内部连续空白折叠为单空格');
  assert(normalizeTagName('深度\t工作') === '深度 工作', 'Tab 也折叠为空格');
  // 大小写敏感：不改大小写（与 tags 唯一索引按原文比较一致）。
  assert(normalizeTagName('AI') === 'AI' && normalizeTagName('ai') === 'ai', '不改大小写');
  assert(normalizeTagName('AI') !== normalizeTagName('ai'), '大小写视为不同名');
  // 非字符串 / 空。
  assert(normalizeTagName(null) === '', 'null → 空串');
  assert(normalizeTagName(undefined) === '', 'undefined → 空串');
  assert(normalizeTagName(123) === '', '数字 → 空串');
  assert(normalizeTagName('   ') === '', '纯空白 → 空串');
  assert(normalizeTagName('###') === '', '纯井号 → 空串');
  // 超长截断到 MAX_TAG_LENGTH。
  const long = '字'.repeat(80);
  assert(normalizeTagName(long).length === MAX_TAG_LENGTH, `超长截断到 ${MAX_TAG_LENGTH}`, `len=${normalizeTagName(long).length}`);
}

// ---- 2. isValidTagName ----
console.log('2. isValidTagName 校验');
{
  assert(isValidTagName('心理学') === true, '正常名合法');
  assert(isValidTagName('') === false, '空串非法');
  assert(isValidTagName('字'.repeat(MAX_TAG_LENGTH)) === true, '恰好上限合法');
  assert(isValidTagName('字'.repeat(MAX_TAG_LENGTH + 1)) === false, '超上限非法');
}

// ---- 3. dedupeIds ----
console.log('3. dedupeIds 去重保序');
{
  assert(JSON.stringify(dedupeIds(['a', 'b', 'a', 'c'])) === JSON.stringify(['a', 'b', 'c']), '去重保序');
  assert(JSON.stringify(dedupeIds(['a', '', '  ', 'b'])) === JSON.stringify(['a', 'b']), '剔空白');
  assert(JSON.stringify(dedupeIds(['a', 123, null, 'b'] as unknown[])) === JSON.stringify(['a', 'b']), '剔非字符串');
  assert(dedupeIds([]).length === 0, '空数组 → []');
  assert(JSON.stringify(dedupeIds([' x ', 'x'])) === JSON.stringify(['x']), '去空白后再去重');
}

// ---- 4. planTagRename ----
console.log('4. planTagRename 改名规划');
{
  const existing: ExistingTag[] = [
    { id: 't1', name: '心理学' },
    { id: 't2', name: '决策偏差' },
    { id: 't3', name: 'AI' },
  ];

  // noop：与原名相同（含归一化后相同）。
  {
    const p = planTagRename('t1', '心理学', existing);
    assert(p.action === 'noop' && p.name === '心理学', '同名 → noop');
  }
  {
    const p = planTagRename('t1', '  #心理学 ', existing);
    assert(p.action === 'noop', '归一化后与原名相同 → noop');
  }

  // rename：新名未被占用。
  {
    const p = planTagRename('t1', '认知心理学', existing);
    assert(p.action === 'rename' && p.name === '认知心理学' && p.mergeTargetId === null, '空闲新名 → rename');
  }

  // merge：新名撞到另一个标签。
  {
    const p = planTagRename('t1', '决策偏差', existing);
    assert(p.action === 'merge' && p.mergeTargetId === 't2', '撞已有标签 → merge 到该标签');
  }
  {
    // 归一化后撞名（带 # 和多空格）。
    const p = planTagRename('t1', '# 决策偏差', existing);
    assert(p.action === 'merge' && p.mergeTargetId === 't2', '归一化后撞名 → merge');
  }
  {
    // 大小写不同不算撞名（AI vs ai）。
    const p = planTagRename('t1', 'ai', existing);
    assert(p.action === 'rename', '大小写不同 → 不合并（rename）');
  }

  // 非法名 → name 空。
  {
    const p = planTagRename('t1', '   ', existing);
    assert(p.name === '' && p.action === 'noop', '空白新名 → name 空（路由回 400）');
  }
  {
    const p = planTagRename('t1', '###', existing);
    assert(p.name === '', '纯井号新名 → name 空');
  }

  // 源不存在 → 保守 noop（路由的归属校验会先拦截）。
  {
    const p = planTagRename('nope', '新名', existing);
    assert(p.action === 'noop', '源不在清单 → 保守 noop');
  }
}

// ---- 5. planTagMerge ----
console.log('5. planTagMerge 合并规划');
{
  const owned = new Set(['t1', 't2', 't3', 't4']);

  // 正常多源：去重、剔目标自身。
  {
    const p = planTagMerge(['t1', 't2', 't2', 't4'], 't4', owned);
    assert(p.ok === true, '正常合并 ok');
    assert(JSON.stringify(p.sourceIds) === JSON.stringify(['t1', 't2']), '去重 + 剔目标自身', JSON.stringify(p.sourceIds));
    assert(p.targetId === 't4', '目标正确');
  }

  // 缺目标。
  {
    const p = planTagMerge(['t1'], '', owned);
    assert(p.ok === false && p.reason === 'no-target', '缺目标 → no-target');
  }
  {
    const p = planTagMerge(['t1'], undefined, owned);
    assert(p.ok === false && p.reason === 'no-target', 'undefined 目标 → no-target');
  }

  // 目标非本人。
  {
    const p = planTagMerge(['t1'], 'other', owned);
    assert(p.ok === false && p.reason === 'target-not-owned', '目标非本人 → target-not-owned');
  }

  // 源全被过滤（非本人 / 只剩目标自身）→ no-source。
  {
    const p = planTagMerge(['x', 'y'], 't1', owned);
    assert(p.ok === false && p.reason === 'no-source', '源都非本人 → no-source');
  }
  {
    const p = planTagMerge(['t1'], 't1', owned);
    assert(p.ok === false && p.reason === 'no-source', '只选了目标自己 → no-source');
  }
  {
    const p = planTagMerge([], 't1', owned);
    assert(p.ok === false && p.reason === 'no-source', '空源 → no-source');
  }

  // 混合：本人源 + 非本人源 + 目标自身 + 重复 → 只留有效本人源。
  {
    const p = planTagMerge(['t1', 'other', 't2', 't2', 't3'], 't3', owned);
    assert(p.ok === true && JSON.stringify(p.sourceIds) === JSON.stringify(['t1', 't2']), '混合清洗：留 t1,t2（剔 other/重复/目标）', JSON.stringify(p.sourceIds));
  }
}

// ---- 6. 合并去重语义说明 ----
console.log('6. 合并去重语义（计划层不重复列源）');
{
  const owned = new Set(['a', 'b', 'c']);
  // 即便用户重复传同一个源 id，计划层只列一次；note_tags 行级去重由 SQL 的 ON CONFLICT DO NOTHING 保证。
  const p = planTagMerge(['a', 'a', 'a', 'b'], 'c', owned);
  assert(p.sourceIds.length === 2, '重复源在计划层折叠为 2 个', `实际 ${p.sourceIds.length}`);
}

// ---- 汇总 ----
if (failed > 0) {
  console.error(`\n❌ ${failed} 项断言失败`);
  process.exit(1);
}
console.log('\n✅ 标签管理纯逻辑（归一化 / 改名规划 / 合并规划 / 去重）全部通过');
