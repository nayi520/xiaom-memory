/**
 * 跨前后端共享常量（避免魔数在多处漂移）。
 *
 * 目前只含「会议判定阈值」：会议没有单独的存储类型，它就是「长语音」——
 * 后端总结（features/digest/summarize.ts）按转写字数分流（≥ 阈值 → 会议纪要格式，
 * 否则轻量 P8），前端的「会议」徽标/筛选也据同一阈值判定，二者必须一致，故抽到此处单点定义。
 */

/**
 * 转写字数阈值：转写长度 ≥ 此值即判定为「会议记录」（走会议纪要格式 / 显示会议徽标 / 可被会议筛选命中），
 * 否则按普通「语音速记」处理。可经 env `MEMORY_MEETING_MIN_CHARS` 覆盖；非法/非正值回退缺省 800。
 *
 * 纯按转写长度判定 → 零额外存储、对短语音无影响、前后端口径完全一致。
 */
export const MEETING_MIN_CHARS = (() => {
  const n = Number(process.env.MEMORY_MEETING_MIN_CHARS);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 800;
})();

/**
 * 纯函数：按「类型 + 转写字数」判定一条记录是否为会议。
 *
 * 与后端 summarize.ts 的分流口径一致：仅语音（type==='voice'）、且**已去首尾空白的**转写字数 ≥ 阈值。
 * 入参 `transcriptLength` 应为 `char_length(trim(transcript))`——
 * 在列表/时间线场景由 SQL 计算后传入（不要把整段 transcript 取到内存），仅在已有完整转写时才在 JS 里算。
 */
export function isMeetingNote(input: {
  type: string | null | undefined;
  /** 已 trim 的转写字符数（来自 SQL `char_length(trim(transcript))` 或 JS `transcript.trim().length`）。 */
  transcriptLength: number | null | undefined;
}): boolean {
  return input.type === 'voice' && (input.transcriptLength ?? 0) >= MEETING_MIN_CHARS;
}
