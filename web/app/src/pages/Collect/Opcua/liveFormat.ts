/**
 * @fileoverview 实时读数在表格里怎么显示。
 *
 * ⚠ 三档必须分得开，合并任意两档都会造出一条假读数：
 * - **没收到过**：采集侧还没上报过它。空着，不写 0、不写「—」以外的任何值。
 * - **取不到**（`error`）：连原因一起摆出来。
 * - **陈旧**（`stale`）：值照显示但标成陈旧，且时刻是**旧值**的时刻——
 *   拿当前墙钟顶替，陈旧值在界面上就与新值完全一样（runtime-resilience §9）。
 */
import type { DtIntent, PointQuality, PointSample } from '@dt/contracts'

export interface SampleLook {
  /** 值本身，带单位。 */
  text: string
  /** 状态标签；没有状态可说时为 null（正常现值）。 */
  badge: string | null
  intent: DtIntent
  /** 采样时刻的本地时间；没有就是空串。 */
  at: string
  /** 出错原因；没有就是 null。 */
  reason: string | null
}

const QUALITY_LABELS: Record<PointQuality, string> = {
  good: '',
  uncertain: '质量存疑',
  bad: '质量不可用',
}

const MISSING: SampleLook = {
  text: '—',
  badge: '未上报',
  intent: 'neutral',
  at: '',
  reason: null,
}

/** 小数位数。现场的模拟量是 32 位浮点，原样显示会摆出一长串换算噪声。 */
const DECIMALS = 2

/**
 * 数值转成能显示的一段。
 *
 * ⚠ 整数不补小数位：开关量、计数器、状态码都是整数点位，把它们写成 `1.00`
 * 会让人以为那是一个测量值。
 * ⚠ 非有限值原样透出：`toFixed` 会把 NaN 写成 `"NaN"` 而把 Infinity 写成
 * `"Infinity"`，两者都不该冒充成一个读数。
 * @param value 读数
 */
function numberText(value: number): string {
  if (!Number.isFinite(value) || Number.isInteger(value)) return String(value)
  return value.toFixed(DECIMALS)
}

/** 值转成能显示的一行。⚠ `0` / `false` / `''` 都是合法读数，不当成「没有值」。 */
function textOf(value: unknown, unit: string | null | undefined): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  const body =
    typeof value === 'number'
      ? numberText(value)
      : typeof value === 'string'
        ? value
        : JSON.stringify(value)
  return unit === null || unit === undefined || unit === ''
    ? body
    : `${body} ${unit}`
}

function timeOf(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString('zh-CN', { hour12: false })
}

/**
 * 一条读数的长相。
 * @param sample 收到的读数；没收到过就是 undefined
 * @param unit 点位单位
 */
export function formatSample(
  sample: PointSample | undefined,
  unit: string | null | undefined,
): SampleLook {
  if (sample === undefined) return MISSING
  if (sample.state === 'error') {
    return {
      text: '—',
      badge: '取不到',
      intent: 'danger',
      at: '',
      reason: sample.errorMessage,
    }
  }
  const quality = QUALITY_LABELS[sample.quality]
  const isStale = sample.state === 'stale'
  return {
    text: textOf(sample.value, unit),
    // 陈旧优先于质量位：值太旧时，它是不是「好质量」已经不重要了
    badge: isStale ? '陈旧' : quality === '' ? null : quality,
    intent: isStale || quality !== '' ? 'warning' : 'success',
    at: timeOf(sample.timestampMs),
    reason: null,
  }
}
