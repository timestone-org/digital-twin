/**
 * @fileoverview 趋势图的桶宽：一段窗口该按多粗的桶去聚合，以及桶与桶之间空了
 * 一大截时怎么把它画成断档。纯函数，与 Vue 无关。
 *
 * ⚠ 桶数必须 ≤ `TREND_BUCKET_CAP`：后端一次聚合的行数上限是「每个点位
 * `MAX_PAGE_SIZE` 桶」，问超了会**在中途截断**。触顶后端会如实标出来，但那时
 * 曲线已经缺了后半段——与其事后解释，不如一开始就别问超。
 * ⚠ 也不能一味往粗里选：桶越粗，尖峰被均值抹得越平，而一条被抹平的曲线看着
 * 完全正常。故取「不超上限的前提下最细的那一档」。
 */
import type { HistoryPoint } from '@dt/contracts'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** 一次聚合每个点位最多回多少桶，与后端 `MAX_PAGE_SIZE` 同值。 */
export const TREND_BUCKET_CAP = 200

/**
 * 选档时瞄准的桶数，**刻意留在上限之下**。
 * ⚠ 差的那几格不是保守，是必需：桶起点由库按业务时区对齐，窗口两端各会多出
 * 半格，正好卡在上限上选出来的档会因此溢出一两行，换回一条被截了尾的曲线。
 */
const TREND_BUCKET_TARGET = 190

/** 一档桶宽：接口上的写法与它的毫秒数。 */
export interface TrendBucket {
  /** `15m` 这样的写法，直接进接口。 */
  value: string
  ms: number
  /** 说给人看的那句，例如「15 分钟」。 */
  label: string
}

/** 桶宽的档位表，从细到粗。取值都落在后端 `^\d{1,4}(s|m|h|d)$` 的形状里。 */
const LADDER: readonly TrendBucket[] = [
  { value: '1s', ms: SECOND, label: '1 秒' },
  { value: '2s', ms: 2 * SECOND, label: '2 秒' },
  { value: '5s', ms: 5 * SECOND, label: '5 秒' },
  { value: '10s', ms: 10 * SECOND, label: '10 秒' },
  { value: '15s', ms: 15 * SECOND, label: '15 秒' },
  { value: '30s', ms: 30 * SECOND, label: '30 秒' },
  { value: '1m', ms: MINUTE, label: '1 分钟' },
  { value: '2m', ms: 2 * MINUTE, label: '2 分钟' },
  { value: '5m', ms: 5 * MINUTE, label: '5 分钟' },
  { value: '10m', ms: 10 * MINUTE, label: '10 分钟' },
  { value: '15m', ms: 15 * MINUTE, label: '15 分钟' },
  { value: '30m', ms: 30 * MINUTE, label: '30 分钟' },
  { value: '1h', ms: HOUR, label: '1 小时' },
  { value: '2h', ms: 2 * HOUR, label: '2 小时' },
  { value: '3h', ms: 3 * HOUR, label: '3 小时' },
  { value: '6h', ms: 6 * HOUR, label: '6 小时' },
  { value: '12h', ms: 12 * HOUR, label: '12 小时' },
  { value: '1d', ms: DAY, label: '1 天' },
]

/** 后端 `\d{1,4}` 的位数上限，用天做兜底时不许越过它。 */
const MAX_AMOUNT = 9999

/**
 * 这段窗口该按多粗的桶聚合：不超桶数上限的前提下最细的那一档。
 * ⚠ 窗口粗到连 1 天的桶都装不下时（约 200 天以上）落到「几天一桶」兜底，
 * 而不是拿最粗那一档硬上——那会问超上限，换回一条半截的曲线。
 * @param windowMs 窗口长度（毫秒）
 */
export function chooseTrendBucket(windowMs: number): TrendBucket {
  const span = Math.max(windowMs, 1)
  const found = LADDER.find((one) => span / one.ms <= TREND_BUCKET_TARGET)
  if (found !== undefined) return found
  const days = Math.min(
    Math.ceil(span / (TREND_BUCKET_TARGET * DAY)),
    MAX_AMOUNT,
  )
  return { value: `${days}d`, ms: days * DAY, label: `${days} 天` }
}

/**
 * 桶数触顶时说的那一句。
 * ⚠ 必须说清砍掉的是哪一头：聚合按桶起点升序取，触顶时留下的是**最早**那一批
 * （与逐条读数同向），缺的是更晚那一段。
 * @param bucket 这次用的桶宽
 */
export function bucketTruncationHint(bucket: TrendBucket): string {
  return (
    `这段时间按 ${bucket.label} 一格分下来超过了 ${TREND_BUCKET_CAP} 格上限，` +
    '图上只画了最早的那一批；更晚的那一段没有画出来，把时间范围缩小再查一次' +
    '才看得到。'
  )
}

/**
 * 桶与桶之间空了一大截时插一个断档点。
 * ⚠ 不插的话 echarts 会把缺口两端**连成一条直线**，那条直线看着像「这段时间
 * 值一直在平稳变化」，而实际上那段时间一条读数都没有。
 * ⚠ 判据是「空过 1.5 个桶」而不是「不等于 1 个桶」：桶起点由库按业务时区对齐，
 * 前端不复算那份对齐，只认明显的空洞（复算一份必然与库漂开，见 §4.5.1）。
 * @param sorted 已按时刻升序排好的桶
 * @param bucketMs 桶宽（毫秒）
 */
export function withBucketGaps(
  sorted: readonly HistoryPoint[],
  bucketMs: number,
): HistoryPoint[] {
  const found: HistoryPoint[] = []
  let previous: number | null = null
  for (const one of sorted) {
    if (previous !== null && one.t - previous > bucketMs * 1.5) {
      found.push({ t: previous + bucketMs, v: null })
    }
    found.push(one)
    previous = one.t
  }
  return found
}
