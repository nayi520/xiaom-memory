/**
 * 单条记录 → Markdown 纯函数验证（noteToMarkdown / deriveNoteTitle）
 *
 * 运行：pnpm test:export   （= tsx scripts/test-export.ts）
 *
 * 覆盖（V29 导出与分享）：
 * 1. 文本记录：标题(summary 首句) + 元信息 + 正文 + 为什么重要
 * 2. 语音记录：raw_content 为 AI 整理稿 + transcript 不同 → 附「原始转写」引用块；hasMedia → (音频附件)
 * 3. 会议纪要：raw_content 已是结构化 Markdown（标题/列表/任务）→ 原样保留、可读
 * 4. 链接记录：url → 「来源：」行；标题回退正文
 * 5. 图片记录：hasMedia → (图片附件)；OCR 文本作正文
 * 6. 缺字段兜底：空 note / 无 summary 无正文 → 「类型 · 日期」标题、不崩
 * 7. 特殊字符：emoji / 标点 / 反引号 / 中文 → 逐字保留，不转义不丢
 * 8. includeTranscript=false / transcript==正文 → 不附原始转写
 * 9. headingLevel：整库导出降为二级标题
 * 10. deriveNoteTitle：summary 首句 / 去标记首行 / 类型+日期兜底 / 截断
 * 11. 空白整理：CRLF 归一、3+ 连续空行压成 2、首尾去空白
 */

import { noteToMarkdown, deriveNoteTitle } from '../src/features/export/noteMarkdown';

let failed = 0;

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    console.error(`  ❌ ${name}${detail ? `\n     ${detail}` : ''}`);
  }
}

const DAY = '2026-06-20T08:30:00.000Z';

// ---- 1. 文本记录 ----
console.log('1. 文本记录');
{
  const md = noteToMarkdown({
    type: 'text',
    rawContent: '今天读到一个观点：深度工作是稀缺能力。\n\n值得反复练习。',
    summary: '深度工作是稀缺能力。后面还有更多总结内容不应进标题。',
    whyImportant: '想把它用到自己的日程安排上',
    createdAt: DAY,
  });
  assert(md.startsWith('# 深度工作是稀缺能力。'), '标题取 summary 首句', md.split('\n')[0]);
  assert(md.includes('> 文本 · 2026-06-20'), '元信息行：类型 · 日期', md);
  assert(md.includes('今天读到一个观点'), '正文保留');
  assert(md.includes('> 💡 **为什么重要**：想把它用到自己的日程安排上'), '为什么重要引用块');
  assert(!md.includes('（音频附件）') && !md.includes('（图片附件）'), '无附件标注');
}

// ---- 2. 语音记录（AI 整理稿 + 原始转写不同）----
console.log('2. 语音记录（含原始转写）');
{
  const md = noteToMarkdown({
    type: 'voice',
    rawContent: '## 摘要\n讨论了下周排期。\n\n## 🔑 关键要点\n- 周三上线',
    transcript: '呃 那个 我们下周三上线 然后排期就这样吧',
    summary: '下周排期讨论',
    hasMedia: true,
    createdAt: DAY,
  });
  assert(md.includes('> 语音 · 2026-06-20'), '元信息：语音');
  assert(md.includes('## 摘要') && md.includes('- 周三上线'), '正文为 AI 整理稿（结构化保留）');
  assert(md.includes('（音频附件）'), 'hasMedia 标注（音频附件）');
  assert(md.includes('**原始转写**'), '附原始转写小标题');
  assert(md.includes('> 呃 那个 我们下周三上线'), '原始转写作引用块');
  // 原始转写应在正文之后。
  assert(md.indexOf('## 摘要') < md.indexOf('**原始转写**'), '原始转写在正文之后');
}

// ---- 3. 会议纪要（结构化 Markdown 直接可读）----
console.log('3. 会议纪要');
{
  const meeting = [
    '# 产品周会纪要',
    '',
    '## 摘要',
    '本周聚焦导出与分享功能。',
    '',
    '## ✅ 待办 / 行动项',
    '- [ ] 周五前完成导出端点',
    '- [x] 确认文件命名',
    '',
    '## 👥 涉及',
    '- 张三、李四',
  ].join('\n');
  const md = noteToMarkdown({
    type: 'voice',
    rawContent: meeting,
    transcript: meeting, // 会议常见：raw_content 与 transcript 已一致 → 不重复附
    summary: '产品周会纪要',
    hasMedia: true,
    createdAt: DAY,
  });
  assert(md.includes('## ✅ 待办 / 行动项'), '会议结构标题保留');
  assert(md.includes('- [ ] 周五前完成导出端点') && md.includes('- [x] 确认文件命名'), '任务清单逐字保留');
  assert(!md.includes('**原始转写**'), 'transcript==正文 → 不附原始转写（不重复）');
}

// ---- 4. 链接记录 ----
console.log('4. 链接记录');
{
  const md = noteToMarkdown({
    type: 'link',
    rawContent: '一篇关于记忆曲线的好文章。',
    url: 'https://example.com/spaced-repetition',
    createdAt: DAY,
  });
  assert(md.includes('> 链接 · 2026-06-20'), '元信息：链接');
  assert(md.includes('来源：https://example.com/spaced-repetition'), '来源行含 url');
  assert(md.startsWith('# 一篇关于记忆曲线的好文章。'), '无 summary → 标题回退正文首行', md.split('\n')[0]);
}

// ---- 5. 图片记录 ----
console.log('5. 图片记录');
{
  const md = noteToMarkdown({
    type: 'image',
    rawContent: 'OCR 文本：会议白板上的三个要点。',
    hasMedia: true,
    createdAt: DAY,
  });
  assert(md.includes('> 图片 · 2026-06-20'), '元信息：图片');
  assert(md.includes('OCR 文本：会议白板'), 'OCR 正文保留');
  assert(md.includes('（图片附件）'), 'hasMedia 标注（图片附件）');
  assert(!md.includes('http'), '不外链任何地址（隐私）');
}

// ---- 6. 缺字段兜底 ----
console.log('6. 缺字段兜底');
{
  // 全空（只有 type）：标题用类型兜底（无日期）；不应抛错。
  const md1 = noteToMarkdown({ type: 'text' });
  assert(md1.startsWith('# 文本记录'), '全空 → 类型兜底标题', md1.split('\n')[0]);
  assert(md1.includes('> 文本'), '元信息至少有类型');

  // 无 summary、无正文，但有类型 + 日期 → 「类型 · 日期」。
  const md2 = noteToMarkdown({ type: 'voice', createdAt: DAY });
  assert(md2.startsWith('# 语音记录 · 2026-06-20'), '无正文 → 类型 · 日期', md2.split('\n')[0]);

  // null 字段不应进入输出。
  const md3 = noteToMarkdown({
    type: 'text',
    rawContent: '正文',
    summary: null,
    transcript: null,
    url: null,
    whyImportant: null,
    hasMedia: null,
    createdAt: null,
  });
  assert(md3.includes('正文') && !md3.includes('来源：') && !md3.includes('为什么重要'), 'null 字段全跳过');
  assert(!md3.includes('undefined') && !md3.includes('null'), '输出无 undefined/null 字样');

  // 未知类型：原样作类型标签，不崩。
  const md4 = noteToMarkdown({ type: 'pdf', rawContent: 'x', createdAt: DAY });
  assert(md4.includes('> pdf · 2026-06-20'), '未知类型原样作标签');
}

// ---- 7. 特殊字符 ----
console.log('7. 特殊字符');
{
  const body = '代码：`const x = 1`；进度 100% ✅ 完成 — 给 @张三 发「邮件」！';
  const md = noteToMarkdown({
    type: 'text',
    rawContent: body,
    summary: 'emoji 与标点 🚀 测试',
    createdAt: DAY,
  });
  assert(md.includes('`const x = 1`'), '反引号代码逐字保留');
  assert(md.includes('100% ✅ 完成 — 给 @张三 发「邮件」！'), 'emoji/标点/中文逐字保留', md);
  assert(md.includes('# emoji 与标点 🚀 测试'), '标题含 emoji');
}

// ---- 8. includeTranscript 开关 ----
console.log('8. includeTranscript 开关');
{
  const note = {
    type: 'voice' as const,
    rawContent: '整理稿正文',
    transcript: '原始转写文本',
    createdAt: DAY,
  };
  const withT = noteToMarkdown(note, { includeTranscript: true });
  const without = noteToMarkdown(note, { includeTranscript: false });
  assert(withT.includes('**原始转写**'), 'includeTranscript=true 附转写');
  assert(!without.includes('**原始转写**'), 'includeTranscript=false 不附转写');
}

// ---- 9. headingLevel ----
console.log('9. headingLevel');
{
  const md = noteToMarkdown(
    { type: 'text', rawContent: '正文', summary: '标题', createdAt: DAY },
    { headingLevel: 2 }
  );
  assert(md.startsWith('## 标题'), 'headingLevel=2 → 二级标题', md.split('\n')[0]);
  // 越界值夹紧到 [1,6]。
  const md0 = noteToMarkdown({ type: 'text', summary: 'A' }, { headingLevel: 0 });
  assert(md0.startsWith('# A'), 'headingLevel<1 夹紧为 1');
  const md9 = noteToMarkdown({ type: 'text', summary: 'A' }, { headingLevel: 9 });
  assert(md9.startsWith('###### A'), 'headingLevel>6 夹紧为 6');
}

// ---- 10. deriveNoteTitle ----
console.log('10. deriveNoteTitle');
{
  assert(
    deriveNoteTitle({ type: 'text', summary: '第一句。第二句。', rawContent: '正文' }) === '第一句。',
    'summary 首句优先（按句末标点切）'
  );
  assert(
    deriveNoteTitle({ type: 'voice', summary: null, rawContent: '## 标题\n- 列表项' }) === '标题',
    'summary 空 → 去掉标记的正文首行'
  );
  assert(
    deriveNoteTitle({ type: 'image', summary: '', rawContent: '', createdAt: DAY }) === '图片记录 · 2026-06-20',
    '皆空 → 类型 · 日期'
  );
  assert(
    deriveNoteTitle({ type: 'link', summary: '', rawContent: '' }) === '链接记录',
    '皆空且无日期 → 仅类型'
  );
  const long = 'a'.repeat(100);
  const title = deriveNoteTitle({ type: 'text', summary: long });
  assert(title.length === 81 && title.endsWith('…'), '超长截断到 80 + 省略号', `len=${title.length}`);
  // 任务清单首行：去掉 - [ ] 标记。
  assert(
    deriveNoteTitle({ type: 'voice', summary: '', rawContent: '- [ ] 待办一\n- [ ] 待办二' }) === '待办一',
    '去掉任务清单标记取首行'
  );
}

// ---- 11. 空白整理 ----
console.log('11. 空白整理');
{
  const md = noteToMarkdown({
    type: 'text',
    rawContent: '第一段\r\n\r\n\r\n\r\n第二段',
    summary: '标题',
    createdAt: DAY,
  });
  assert(!md.includes('\r'), 'CRLF 归一为 LF');
  assert(!md.includes('\n\n\n'), '3+ 连续空行压成 ≤2');
  assert(md.includes('第一段\n\n第二段'), '段落间距规整为一个空行');
  assert(!md.startsWith('\n') && !md.endsWith('\n') && !md.endsWith(' '), '首尾无多余空白');
}

// ---- 汇总 ----
if (failed > 0) {
  console.error(`\n❌ ${failed} 项断言失败`);
  process.exit(1);
}
console.log('\n✅ noteToMarkdown / deriveNoteTitle 全部通过');
