/**
 * 行动项解析 + 聚合逻辑验证（纯函数，不依赖数据库 / API）
 *
 * 运行：pnpm test:todos   （= tsx scripts/test-todos.ts）
 *
 * 覆盖：
 * 1. 空 / null / undefined raw_content → 空数组
 * 2. 无待办（普通列表、纯文本、标题）→ 空数组
 * 3. 混合勾选（- [ ] / - [x] / - [X]）→ 文本 + checked 正确
 * 4. 多区块（P8 「✅ 待办」+ 会议「📌 待办」）→ 全部解析、顺序保留
 * 5. 容错语法：前导空格 / Tab 缩进、* 与 + 列表符、[ ] 内空白
 * 6. 特殊字符（emoji / 标点 / 中文）→ 文本完整保留；itemKey 归一化稳定
 * 7. 非待办（- 文本 无方括号 / [] 空 / [ab] 多字符）不误判
 * 8. itemKey：归一化（大小写/标点/空白）一致；不同文本不同
 * 9. buildTodoLists：open/done 分组、completedKeys 覆盖源 [x]、记录内去重、时间倒序
 * 10. deriveNoteTitle：summary 优先 / raw_content 首行 / 类型兜底 / 截断
 */

import {
  parseTodos,
  todoItemKey,
  normalizeTodoText,
} from '../src/features/todos/parse';
import {
  buildTodoLists,
  deriveNoteTitle,
  type TodoSourceNote,
} from '../src/features/todos';

let failed = 0;

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    console.error(`  ❌ ${name}${detail ? `\n     ${detail}` : ''}`);
  }
}

// ---- 1. 空 / null / undefined ----
console.log('1. 空输入');
{
  assert(parseTodos('').length === 0, '空串 → []');
  assert(parseTodos(null).length === 0, 'null → []');
  assert(parseTodos(undefined).length === 0, 'undefined → []');
  assert(parseTodos('   \n\n  ').length === 0, '纯空白 → []');
}

// ---- 2. 无待办 ----
console.log('2. 无待办内容');
{
  assert(parseTodos('## 🔑 关键要点\n\n- 心流\n- 深度工作').length === 0, '普通列表不算待办');
  assert(parseTodos('这是一段纯文本，没有任何待办。').length === 0, '纯文本 → []');
  assert(parseTodos('# 标题\n## 小标题\n正文').length === 0, '仅标题正文 → []');
}

// ---- 3. 混合勾选 ----
console.log('3. 混合勾选');
{
  const md = '## ✅ 待办 / 行动项\n\n- [ ] 周五前给张三回邮件\n- [x] 确认预算\n- [X] 预订会议室';
  const todos = parseTodos(md);
  assert(todos.length === 3, '解析出 3 条', `实际 ${todos.length}`);
  assert(todos[0].text === '周五前给张三回邮件' && todos[0].checked === false, '第 1 条未完成');
  assert(todos[1].text === '确认预算' && todos[1].checked === true, '第 2 条已完成（小写 x）');
  assert(todos[2].text === '预订会议室' && todos[2].checked === true, '第 3 条已完成（大写 X）');
}

// ---- 4. 多区块 ----
console.log('4. 多区块（速记 + 会议）');
{
  const md = [
    '## 🔑 关键要点',
    '- 项目延期风险',
    '',
    '## ✅ 待办 / 行动项',
    '- [ ] 速记待办一',
    '- [ ] 速记待办二',
    '',
    '## 📌 待办 / 行动项',
    '- [x] 会议待办（已办）',
    '- [ ] 会议待办（未办）',
  ].join('\n');
  const todos = parseTodos(md);
  assert(todos.length === 4, '两区块共 4 条（关键要点不计）', `实际 ${todos.length}`);
  assert(
    todos.map((t) => t.text).join('|') === '速记待办一|速记待办二|会议待办（已办）|会议待办（未办）',
    '顺序保留',
    todos.map((t) => t.text).join('|')
  );
  assert(todos.filter((t) => t.checked).length === 1, '仅 1 条已勾');
}

// ---- 5. 容错语法 ----
console.log('5. 容错语法（缩进 / 列表符 / 内部空白）');
{
  assert(parseTodos('  - [ ] 两空格缩进')[0]?.text === '两空格缩进', '前导空格容忍');
  assert(parseTodos('\t- [ ] Tab 缩进')[0]?.text === 'Tab 缩进', 'Tab 缩进容忍');
  assert(parseTodos('* [ ] 星号列表符')[0]?.text === '星号列表符', '* 列表符容忍');
  assert(parseTodos('+ [x] 加号列表符')[0]?.checked === true, '+ 列表符容忍');
  // [ ] 内允许是单个空白或 x；多空格不是合法 GFM checkbox（必须单字符），应不匹配。
  assert(parseTodos('- [  ] 双空格方括号').length === 0, '[  ] 双空格不匹配（GFM 单字符）');
  // \r\n 换行。
  assert(parseTodos('- [ ] A\r\n- [x] B').length === 2, 'CRLF 换行可解析');
}

// ---- 6. 特殊字符 ----
console.log('6. 特殊字符');
{
  const md = '- [ ] 给 @张三 发邮件（含 100% 把握）🚀 — 周五前!';
  const todos = parseTodos(md);
  assert(todos.length === 1, '解析出 1 条');
  assert(
    todos[0].text === '给 @张三 发邮件（含 100% 把握）🚀 — 周五前!',
    '展示文本完整保留（含 emoji/标点）',
    todos[0].text
  );
  // itemKey 稳定且非空。
  assert(typeof todos[0].itemKey === 'string' && todos[0].itemKey.length === 8, 'itemKey 为 8 位 hex');
}

// ---- 7. 非待办不误判 ----
console.log('7. 非待办不误判');
{
  assert(parseTodos('- 普通列表项').length === 0, '无方括号 → 非待办');
  assert(parseTodos('- [] 空方括号无空格').length === 0, '[] 不匹配');
  assert(parseTodos('- [ab] 多字符').length === 0, '[ab] 不匹配');
  assert(parseTodos('文字 - [ ] 行中标记').length === 0, '非行首标记不匹配');
  assert(parseTodos('- [ ]   ').length === 0, '空正文丢弃');
}

// ---- 8. itemKey 归一化 ----
console.log('8. itemKey 归一化稳定');
{
  // 大小写 / 尾随标点 / 内部空白差异 → 同 key。
  assert(todoItemKey('确认预算') === todoItemKey('确认预算。'), '尾标点不影响 key');
  assert(todoItemKey('确认预算') === todoItemKey('确认 预算'), '内部空白不影响 key');
  assert(todoItemKey('Call Bob') === todoItemKey('call bob'), '大小写不影响 key');
  assert(todoItemKey('给张三回邮件') !== todoItemKey('给李四回邮件'), '不同文本不同 key');
  assert(normalizeTodoText('  Hello,  World! ') === 'helloworld', '归一化：小写+去标点+去空白', normalizeTodoText('  Hello,  World! '));
}

// ---- 9. buildTodoLists 聚合 ----
console.log('9. buildTodoLists 聚合');
{
  const notes: TodoSourceNote[] = [
    {
      id: 'n2',
      type: 'voice',
      summary: '会议纪要',
      rawContent: '## 📌 待办 / 行动项\n- [ ] 新会议待办\n- [x] 源已完成项',
      createdAt: '2026-06-20T00:00:00Z',
    },
    {
      id: 'n1',
      type: 'voice',
      summary: '速记摘要',
      rawContent: '## ✅ 待办 / 行动项\n- [ ] 速记待办A\n- [ ] 速记待办A\n- [ ] 速记待办B',
      createdAt: '2026-06-10T00:00:00Z',
    },
    {
      id: 'n0',
      type: 'text',
      summary: '无待办记录',
      rawContent: '## 🔑 关键要点\n- 只有要点',
      createdAt: '2026-06-01T00:00:00Z',
    },
  ];
  // completedKeys：把 n1 的「速记待办B」标记为完成（覆盖源 [ ]）。
  const bKey = todoItemKey('速记待办B');
  const completed = new Set<string>([`n1:${bKey}`]);
  const { open, done } = buildTodoLists(notes, completed);

  // open：n2「新会议待办」+ n1「速记待办A」（去重后一条）= 2 条；记录时间倒序（n2 在前）。
  assert(open.length === 2, 'open 2 条（A 去重、B 已完成移走）', `实际 ${open.length}: ${open.map((t) => t.text).join(',')}`);
  assert(open[0].noteId === 'n2' && open[0].text === '新会议待办', 'open 按记录时间倒序（n2 先）');
  assert(open[1].text === '速记待办A', 'open 内同记录待办 A（去重为 1）');

  // done：n2 源 [x]「源已完成项」+ n1「速记待办B」（completedKeys 命中）= 2 条。
  const doneTexts = done.map((t) => t.text).sort().join('|');
  assert(done.length === 2, 'done 2 条（源[x] + 命中completion）', `实际 ${done.length}: ${doneTexts}`);
  assert(doneTexts === '源已完成项|速记待办B', 'done 文本正确', doneTexts);

  // 来源元信息正确。
  assert(open[1].noteTitle === '速记摘要' && open[1].noteType === 'voice', 'open 项带来源标题/类型');
  assert(open[0].itemKey === todoItemKey('新会议待办'), 'itemKey 与解析一致');
}

// ---- 10. deriveNoteTitle ----
console.log('10. deriveNoteTitle 兜底');
{
  assert(
    deriveNoteTitle({ id: 'x', type: 'voice', summary: '这是摘要', rawContent: '正文首行', createdAt: '' }) === '这是摘要',
    'summary 优先'
  );
  assert(
    deriveNoteTitle({ id: 'x', type: 'voice', summary: null, rawContent: '## 关键\n- 一二三', createdAt: '' }) === '## 关键 - 一二三',
    'summary 空 → raw_content（折叠空白）',
    deriveNoteTitle({ id: 'x', type: 'voice', summary: null, rawContent: '## 关键\n- 一二三', createdAt: '' })
  );
  assert(
    deriveNoteTitle({ id: 'x', type: 'image', summary: '', rawContent: '', createdAt: '' }) === '图片记录',
    '皆空 → 类型兜底'
  );
  const long = 'a'.repeat(80);
  const title = deriveNoteTitle({ id: 'x', type: 'text', summary: long, rawContent: '', createdAt: '' });
  assert(title.length === 61 && title.endsWith('…'), '超长截断到 60 + 省略号', `len=${title.length}`);
}

// ---- 汇总 ----
if (failed > 0) {
  console.error(`\n❌ ${failed} 项断言失败`);
  process.exit(1);
}
console.log('\n✅ 行动项解析与聚合逻辑全部通过');
