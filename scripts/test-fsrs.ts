/**
 * FSRS 调度验证（不依赖数据库 / 网络）
 *
 * 运行：pnpm test:fsrs   （= tsx scripts/test-fsrs.ts）
 *
 * 覆盖：
 * 1. 阶段 2 初始结构 {stability:null,difficulty:null,reps:0,due} 反序列化为新卡，due 保留
 * 2. 造 30 张测试卡，按 4 种评分序列模拟多轮复习：
 *    - 连续「轻松」：间隔单调扩大，最终触发毕业（>180 天 + 连续 3 次 4）
 *    - 连续「记得」：间隔单调不减
 *    - 「忘了」：间隔显著缩短（重置）、lapses+1
 *    - 混合序列：状态字段完整、due 始终向未来推进
 * 3. 同一状态下四档评分的间隔排序：轻松 ≥ 记得 ≥ 模糊 ≥ 忘了
 * 4. 毕业判定 shouldGraduate 的边界
 * 5. 遗忘风险排序：逾期越久 / 可提取性越低越靠前
 * 6. 推送估时 estimateMinutes
 */

import {
  applyRating,
  cardFromState,
  estimateMinutes,
  forgettingRisk,
  shouldGraduate,
  sortQueue,
  stateToJson,
  GRADUATE_EASY_STREAK,
  GRADUATE_MIN_INTERVAL_DAYS,
  type FsrsStateJson,
  type ReviewRating,
} from '../src/features/review/fsrs';
import { initialFsrsState } from '../src/features/digest/pipeline';
import { State, default_maximum_interval } from 'ts-fsrs';

// ============ 断言工具 ============

let failed = 0;
let passed = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}`);
  }
}

const DAY = 86_400_000;
const T0 = new Date('2026-06-10T08:00:00.000Z');

/** 阶段 2 流水线写入的初始 fsrs_state（due = 明天） */
function newCardState(): FsrsStateJson {
  return initialFsrsState(
    new Date(T0.getTime() + DAY).toISOString()
  ) as unknown as FsrsStateJson;
}

/** 在每次到期日按给定序列评分，返回每轮的间隔（天）与状态轨迹 */
function simulate(ratings: ReviewRating[], start: FsrsStateJson) {
  let state = start;
  let now = new Date(state.due); // 到期当天复习
  const intervals: number[] = [];
  const states: FsrsStateJson[] = [];
  const recentRatings: number[] = []; // 最新在前
  let graduatedAtRound = -1;

  ratings.forEach((rating, i) => {
    const outcome = applyRating(state, rating, now);
    state = outcome.state;
    intervals.push(outcome.scheduledDays);
    states.push(state);
    recentRatings.unshift(rating);
    if (
      graduatedAtRound === -1 &&
      shouldGraduate(outcome.scheduledDays, recentRatings)
    ) {
      graduatedAtRound = i;
    }
    now = new Date(state.due); // 下一轮在新到期日复习
  });

  return { intervals, states, graduatedAtRound, finalState: state };
}

// ============ 1. 阶段 2 初始结构兼容 ============

console.log('\n— 阶段 2 初始结构兼容 —');
{
  const init = newCardState();
  const card = cardFromState(init);
  assert(card.state === State.New, 'stability:null 反序列化为新卡（State.New）');
  assert(
    card.due.toISOString() === init.due,
    '初始 due 保留（不被反序列化改写）'
  );
  assert(card.reps === 0, 'reps=0 保留');

  const roundTrip = stateToJson(cardFromState(undefined));
  assert(
    roundTrip.stability !== null && roundTrip.difficulty !== null,
    'fsrs_state 缺失时也能容错（空卡默认值）'
  );
}

// ============ 2. 造 30 张卡，多轮评分序列 ============

console.log('\n— 30 张测试卡 · 多轮评分模拟 —');
{
  const SEQUENCES: Record<string, ReviewRating[]> = {
    allEasy: [4, 4, 4, 4, 4, 4, 4, 4],
    allGood: [3, 3, 3, 3, 3, 3, 3, 3],
    goodThenAgain: [3, 3, 3, 1, 3, 3],
    mixed: [3, 4, 2, 3, 4, 1, 3, 4],
  };
  const seqNames = Object.keys(SEQUENCES);

  const cards = Array.from({ length: 30 }, (_, i) => ({
    id: `card-${i + 1}`,
    seq: seqNames[i % seqNames.length],
    state: newCardState(),
  }));
  assert(cards.length === 30, '已创建 30 张测试卡');

  let easyMonotonic = true;
  let easyGraduates = true;
  let goodNonDecreasing = true;
  let againShrinks = true;
  let againLapses = true;
  let dueAlwaysAdvances = true;
  let fieldsComplete = true;
  let easyGradRound = -1;

  for (const card of cards) {
    const ratings = SEQUENCES[card.seq];
    const { intervals, states, graduatedAtRound } = simulate(ratings, card.state);

    // due 单调向前、字段完整
    let prevDue = new Date(card.state.due).getTime();
    for (const s of states) {
      const due = new Date(s.due).getTime();
      if (due < prevDue) dueAlwaysAdvances = false;
      prevDue = due;
      if (
        s.stability == null ||
        s.difficulty == null ||
        typeof s.reps !== 'number' ||
        typeof s.scheduled_days !== 'number' ||
        !s.last_review
      ) {
        fieldsComplete = false;
      }
    }

    if (card.seq === 'allEasy') {
      for (let i = 1; i < intervals.length; i++) {
        // 触达 maximum_interval 上限后允许持平，其余必须严格扩大
        const atCap = intervals[i] >= default_maximum_interval;
        if (intervals[i] <= intervals[i - 1] && !atCap) easyMonotonic = false;
        if (intervals[i] < intervals[i - 1]) easyMonotonic = false;
      }
      if (graduatedAtRound === -1) easyGraduates = false;
      else if (easyGradRound === -1) easyGradRound = graduatedAtRound;
    }

    if (card.seq === 'allGood') {
      for (let i = 1; i < intervals.length; i++) {
        if (intervals[i] < intervals[i - 1]) goodNonDecreasing = false;
      }
    }

    if (card.seq === 'goodThenAgain') {
      // 第 4 次评分是「忘了」（下标 3）：间隔显著缩短
      if (!(intervals[3] < intervals[2])) againShrinks = false;
      if ((states[3].lapses ?? 0) !== 1) againLapses = false;
    }
  }

  assert(easyMonotonic, '连续「轻松」：间隔每轮扩大（仅触达最大间隔上限后持平）');
  assert(
    easyGraduates,
    `连续「轻松」最终触发毕业（间隔 >${GRADUATE_MIN_INTERVAL_DAYS} 天 + 连续 ${GRADUATE_EASY_STREAK} 次评分 4）`
  );
  assert(
    easyGradRound >= GRADUATE_EASY_STREAK - 1,
    `毕业不早于第 ${GRADUATE_EASY_STREAK} 次评分（实际第 ${easyGradRound + 1} 次）`
  );
  assert(goodNonDecreasing, '连续「记得」：间隔单调不减');
  assert(againShrinks, '「忘了」：间隔较上一轮显著缩短（重置）');
  assert(againLapses, '「忘了」：lapses 计数 +1');
  assert(dueAlwaysAdvances, '所有卡 due 始终向未来推进');
  assert(fieldsComplete, '评分后 fsrs_state 字段完整（stability/difficulty/reps/scheduled_days/last_review）');
}

// ============ 3. 同一状态下四档间隔排序 ============

console.log('\n— 四档评分间隔排序 —');
{
  // 先用「记得」复习 3 轮，得到一张成熟的复习卡
  const { finalState } = simulate([3, 3, 3], newCardState());
  const now = new Date(finalState.due);
  const sd = ( [1, 2, 3, 4] as ReviewRating[] ).map(
    (r) => applyRating(finalState, r, now).scheduledDays
  );
  assert(
    sd[3] >= sd[2] && sd[2] >= sd[1] && sd[1] >= sd[0],
    `轻松 ≥ 记得 ≥ 模糊 ≥ 忘了（${sd[3]} / ${sd[2]} / ${sd[1]} / ${sd[0]} 天）`
  );
  assert(sd[3] > sd[0], '「轻松」间隔严格大于「忘了」');
}

// ============ 4. 毕业判定边界 ============

console.log('\n— 毕业判定 shouldGraduate —');
{
  assert(shouldGraduate(200, [4, 4, 4]), '间隔 200 天 + 连续 3 次 4 → 毕业');
  assert(shouldGraduate(181, [4, 4, 4, 1]), '只看最近 3 次：更早的 1 不影响');
  assert(!shouldGraduate(180, [4, 4, 4]), '间隔恰好 180 天（不满足 >180）→ 不毕业');
  assert(!shouldGraduate(200, [4, 4, 3]), '最近 3 次含非 4 → 不毕业');
  assert(!shouldGraduate(200, [4, 3, 4]), '中间断一次 4 → 不毕业');
  assert(!shouldGraduate(200, [4, 4]), '评分不足 3 次 → 不毕业');
}

// ============ 5. 遗忘风险排序 ============

console.log('\n— 遗忘风险排序 —');
{
  const now = new Date(T0.getTime() + 30 * DAY);

  // 成熟复习卡 A：刚到期；成熟复习卡 B：逾期 10 天
  // （逾期 = 上次复习与到期日都整体前移，距上次复习的时间更长 → 可提取性更低）
  const mature = simulate([3, 3, 3], newCardState()).finalState;
  const shiftDays = (s: FsrsStateJson, days: number): FsrsStateJson => ({
    ...s,
    due: new Date(new Date(s.due).getTime() - days * DAY).toISOString(),
    last_review: s.last_review
      ? new Date(new Date(s.last_review).getTime() - days * DAY).toISOString()
      : s.last_review,
  });
  const alignToNow = (s: FsrsStateJson): FsrsStateJson =>
    shiftDays(s, (new Date(s.due).getTime() - now.getTime()) / DAY);
  const justDue = alignToNow(mature); // 恰好今天到期
  const overdue10 = shiftDays(justDue, 10); // 已逾期 10 天
  assert(
    forgettingRisk(overdue10, now) < forgettingRisk(justDue, now),
    '同一张卡逾期 10 天的可提取性 < 刚到期 → 排更前'
  );

  // 新卡：逾期越久越靠前
  const newJustDue: FsrsStateJson = { ...newCardState(), due: now.toISOString() };
  const newOverdue: FsrsStateJson = {
    ...newCardState(),
    due: new Date(now.getTime() - 7 * DAY).toISOString(),
  };
  assert(
    forgettingRisk(newOverdue, now) < forgettingRisk(newJustDue, now),
    '新卡逾期 7 天 → 排在刚到期新卡之前'
  );

  const sorted = sortQueue(
    [
      { id: 'just-due', fsrs_state: justDue },
      { id: 'overdue-10', fsrs_state: overdue10 },
      { id: 'new-overdue', fsrs_state: newOverdue },
    ],
    now
  );
  assert(sorted[0].id !== 'just-due', 'sortQueue：刚到期的卡不在队首');
  assert(
    sorted.findIndex((c) => c.id === 'overdue-10') <
      sorted.findIndex((c) => c.id === 'just-due'),
    'sortQueue：逾期复习卡排在刚到期复习卡之前'
  );
}

// ============ 6. 推送估时 ============

console.log('\n— 推送估时 estimateMinutes —');
{
  assert(estimateMinutes(1) === 1, '1 张 → 1 分钟（向上保底）');
  assert(estimateMinutes(8) === 4, '8 张 × 30 秒 → 4 分钟');
  assert(estimateMinutes(20) === 10, '20 张 → 10 分钟');
  assert(estimateMinutes(50) === 10, '超过每日上限按 20 张估（50 张 → 10 分钟）');
}

// ============ 结果 ============

console.log(
  `\n${failed === 0 ? '✅ 全部通过' : `❌ ${failed} 项失败`}（${passed}/${passed + failed}）`
);
process.exit(failed === 0 ? 0 : 1);
