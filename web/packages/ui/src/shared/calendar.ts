/**
 * @fileoverview 日历面板的取值规则：月格排布、上下界夹取、时分选项。
 *
 * 全部按**本地时**算，与 `datetime.ts` 的 `YYYY-MM-DDTHH:mm` 同一口径——
 * 日历要是自己拿 UTC 算日期，跨零点那几个小时会整体差一天。
 */
import { localMinuteOf } from './datetime'

const LOCAL_MINUTE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/
const DAYS_PER_WEEK = 7
const HOURS_PER_DAY = 24
const MINUTES_PER_HOUR = 60

export interface LocalMinuteParts {
  year: number
  /** 1–12，不是 Date 的 0–11。 */
  month: number
  day: number
  hour: number
  minute: number
}

export interface MonthCursor {
  year: number
  month: number
}

function digits(found: RegExpExecArray, index: number): number {
  return Number(found[index] ?? '0')
}

/** 拆开 `YYYY-MM-DDTHH:mm`；形状不对给 null。 */
export function splitLocalMinute(local: string): LocalMinuteParts | null {
  const found = LOCAL_MINUTE.exec(local)
  if (found === null) return null
  return {
    year: digits(found, 1),
    month: digits(found, 2),
    day: digits(found, 3),
    hour: digits(found, 4),
    minute: digits(found, 5),
  }
}

/**
 * 拼回 `YYYY-MM-DDTHH:mm`。
 * ⚠ 借道本地 Date 而不是直接拼字符串：日期溢出（2 月 31 日）由它归一到下个月，
 * 拼字符串会造出一个根本不存在的日子。
 * @param parts 年月日时分
 */
export function joinLocalMinute(parts: LocalMinuteParts): string {
  return localMinuteOf(
    new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute),
  )
}

/** 取值所在的年月；取值为空时给 null。 */
export function cursorOf(local: string): MonthCursor | null {
  const parts = splitLocalMinute(local)
  return parts === null ? null : { year: parts.year, month: parts.month }
}

/** 此刻所在的年月。⚠ 时钟只在这里读，组件里出现 `new Date()` 会被风格闸拦下。 */
export function currentCursor(): MonthCursor {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

/**
 * 前后翻月。
 * @param cursor 当前年月
 * @param delta 翻几个月，负数往前
 */
export function shiftMonth(cursor: MonthCursor, delta: number): MonthCursor {
  const moved = new Date(cursor.year, cursor.month - 1 + delta, 1)
  return { year: moved.getFullYear(), month: moved.getMonth() + 1 }
}

export interface MonthCell {
  /** 渲染用的稳定标识。⚠ 不能拿下标当 key：补位格与日子混在同一列里。 */
  key: string
  /** 几号；补位格是 null。 */
  day: number | null
}

/**
 * 一个月的格子，按**周一起头**排；前后补位凑满整周。
 * @param cursor 要排的年月
 */
export function monthCells(cursor: MonthCursor): MonthCell[] {
  const stamp = `${cursor.year}-${cursor.month}`
  const first = new Date(cursor.year, cursor.month - 1, 1)
  // getDay() 周日是 0；本地习惯周一起头，整体挪一位
  const blanks = (first.getDay() + 6) % DAYS_PER_WEEK
  const total = new Date(cursor.year, cursor.month, 0).getDate()
  const cells: MonthCell[] = Array.from({ length: blanks }, (_u, index) => ({
    key: `${stamp}-head${index}`,
    day: null,
  }))
  for (let day = 1; day <= total; day += 1) {
    cells.push({ key: `${stamp}-${day}`, day })
  }
  while (cells.length % DAYS_PER_WEEK !== 0) {
    cells.push({ key: `${stamp}-tail${cells.length}`, day: null })
  }
  return cells
}

/**
 * 把取值夹进 `[min, max]`。
 * ⚠ 直接比字符串：`YYYY-MM-DDTHH:mm` 的字典序就是时间序，不必转成时间戳。
 * @param local 待夹取的本地时刻
 * @param min 下界，空串表示不限
 * @param max 上界，空串表示不限
 */
export function clampLocal(local: string, min: string, max: string): string {
  if (local === '') return local
  if (min !== '' && local < min) return min
  if (max !== '' && local > max) return max
  return local
}

/**
 * 这一天有没有任何一分钟落在界内。整天都在界外才禁用。
 * @param cursor 年月
 * @param day 几号
 * @param min 下界，空串表示不限
 * @param max 上界，空串表示不限
 */
export function isDaySelectable(
  cursor: MonthCursor,
  day: number,
  min: string,
  max: string,
): boolean {
  const start = joinLocalMinute({ ...cursor, day, hour: 0, minute: 0 })
  const end = joinLocalMinute({ ...cursor, day, hour: 23, minute: 59 })
  if (min !== '' && end < min) return false
  if (max !== '' && start > max) return false
  return true
}

function counting(total: number): { value: string; label: string }[] {
  return Array.from({ length: total }, (_unused, index) => ({
    value: String(index),
    label: String(index).padStart(2, '0'),
  }))
}

export function hourOptions(): { value: string; label: string }[] {
  return counting(HOURS_PER_DAY)
}

export function minuteOptions(): { value: string; label: string }[] {
  return counting(MINUTES_PER_HOUR)
}
