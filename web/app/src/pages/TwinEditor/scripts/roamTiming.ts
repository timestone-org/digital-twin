/**
 * @fileoverview 漫游时长在「面板上的秒」与「落库的毫秒」之间的换算。
 * ⚠ 面板一律给秒：毫秒少打一个零就是十分之一的时长，而画面上只表现为
 * 「镜头怎么一闪就过去了」，没有任何一处会报错。
 */

const MS_PER_S = 1000
/** 秒最多给到 0.1 秒，再细的差别镜头上看不出来 */
const MS_PER_TENTH = 100
const TENTHS_PER_S = 10

/** 秒的步进，面板上的数字输入共用一套。 */
export const ROAM_SECONDS_STEP = 0.1

/**
 * 毫秒 → 秒，按 0.1 秒取整。
 * ⚠ 先取整成「十分之一秒」再除，不能乘 0.1：`7 * 0.1` 是
 * 0.7000000000000001，这一串会原样出现在输入框里。
 * @param ms 落库的毫秒数
 */
export function roamSeconds(ms: number): number {
  return Math.round(ms / MS_PER_TENTH) / TENTHS_PER_S
}

/**
 * 秒 → 毫秒；输入被清空时退回缺省值。
 * @param seconds 面板上填的秒
 * @param fallback 清空时用的毫秒数
 */
export function roamMs(seconds: number | undefined, fallback: number): number {
  return seconds === undefined ? fallback : Math.round(seconds * MS_PER_S)
}

/**
 * 秒 → 毫秒，允许「没填」。清空即取消这一段的覆盖，回到全局值。
 * @param seconds 面板上填的秒；undefined = 清空
 */
export function roamMsOrNull(seconds: number | undefined): number | null {
  return seconds === undefined ? null : Math.round(seconds * MS_PER_S)
}

/**
 * 毫秒 → 秒，允许「没配」。
 * @param ms 覆盖值；null = 没配
 */
export function roamSecondsOrUndefined(ms: number | null): number | undefined {
  return ms === null ? undefined : roamSeconds(ms)
}
