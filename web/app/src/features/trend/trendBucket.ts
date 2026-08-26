/**
 * @fileoverview 趋势图的取点间隔：一段窗口有哪几档可选、自动档挑哪一个，以及
 * 空档怎么补。纯函数，与 Vue 无关。
 *
 * ⚠ 桶数必须 ≤ `TREND_BUCKET_CAP`：后端一次聚合的行数上限是「每个点位
 * `MAX_PAGE_SIZE` 桶」，问超了会**在中途截断**。触顶后端会如实标出来，但那时
 * 曲线已经缺了后半段——与其事后解释，不如先把够不着的那几档禁掉。
 * ⚠ 空档补的是**上一个读数**而不是断档，且只在归档心跳之内补：订阅模式下
 * 「这一格没有新读数」的正常含义是「值没变」，不是「没有数据」。理由见
 * `holdBucketValues`。
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

/** 「跟着时间范围走」这一档的取值。 */
export const TREND_BUCKET_AUTO = 'auto'

/** 一档取点间隔：接口上的写法与它的毫秒数。 */
export interface TrendBucket {
  /** `15m` 这样的写法，直接进接口。 */
  value: string
  ms: number
  /** 说给人看的那句，例如「15 分钟」。 */
  label: string
}

/** 下拉里的一档：够不着的那些照样列出来，但点不动。 */
export interface TrendBucketChoice {
  value: string
  label: string
  /** 这一档在当前窗口下会问超桶数上限。 */
  isTooFine: boolean
}

/** 取点间隔的档位表，从细到粗。取值都落在后端 `^\d{1,4}(s|m|h|d)$` 的形状里。 */
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
 * 自动档：不超桶数上限的前提下最细的那一档。
 * ⚠ 窗口粗到连 1 天的桶都装不下时（约 200 天以上）落到「几天一格」兜底，
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
 * 界面上选的那一档落成具体的桶宽。
 * ⚠ 认不出来的取值（档位表改过、地址里带了个旧值）一律回落自动档，而不是
 * 硬喂给接口换一个 422。
 * @param windowMs 窗口长度（毫秒）
 * @param wanted 界面上选的档，`auto` 即跟着窗口走
 */
export function resolveTrendBucket(
  windowMs: number,
  wanted: string,
): TrendBucket {
  if (wanted === TREND_BUCKET_AUTO) return chooseTrendBucket(windowMs)
  const found = LADDER.find((one) => one.value === wanted)
  return found !== undefined && !isTooFine(windowMs, found)
    ? found
    : chooseTrendBucket(windowMs)
}

/**
 * 当前窗口下的档位清单，自动档排头。
 * ⚠ 够不着的那几档照样列出来、只是点不动：直接藏掉的话，用户会以为这个软件
 * 就只能看到这么细，而实际上把时间范围缩小一点就选得上了。
 * @param windowMs 窗口长度（毫秒）
 */
export function trendBucketChoices(windowMs: number): TrendBucketChoice[] {
  const auto = chooseTrendBucket(windowMs)
  return [
    {
      value: TREND_BUCKET_AUTO,
      label: `自动（${auto.label}）`,
      isTooFine: false,
    },
    ...LADDER.map((one) => ({
      value: one.value,
      label: one.label,
      isTooFine: isTooFine(windowMs, one),
    })),
  ]
}

function isTooFine(windowMs: number, bucket: TrendBucket): boolean {
  return Math.max(windowMs, 1) / bucket.ms > TREND_BUCKET_TARGET
}

/**
 * 触顶时说的那一句。
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

/** 一次补空档要的三个数。 */
export interface HoldWindow {
  bucketMs: number
  /**
   * 这个点位的归档心跳（`archive_max_interval_ms`）。
   * 0 表示这一路不结转（台账列走的就是这一档，理由见 DATASET_DESIGN D3）。
   */
  holdMs: number
  /** 窗口右端；末尾那一段也照同一条规则补。 */
  toMs: number
}

/**
 * 把空掉的那些格补上「上一个读数」，超出归档心跳的才画成断档。
 *
 * ⚠ 这是本文件的要害。订阅 + 死区模式下，采集器**只在值变了才写一条**——
 * 于是一个稳定的点位在库里就是稀稀拉拉几行，而它每一刻都是有值的。照「没有
 * 样本就是没有数据」画，一条平稳运行的曲线会变成一片虚线，看的人会去查采集。
 * ⚠ 但也不能一路结转到底：那样「值没变」与「采集断了」在图上就再也分不开。
 * 判据取归档心跳：`AdmissionGate` 里「心跳到期也要收一条」那条规则保证了
 * **只要采集在跑，每个心跳周期内至少落一行**（COLLECT_DESIGN §4.3）。所以
 * 「心跳之内没有新读数」= 值没变，「超过心跳还没有」= 那段时间真的没在采。
 * @param sorted 已按时刻升序排好的桶
 * @param window 桶宽、心跳与窗口右端
 */
export function holdBucketValues(
  sorted: readonly HistoryPoint[],
  window: HoldWindow,
): HistoryPoint[] {
  const { bucketMs, holdMs, toMs } = window
  const holdBuckets =
    holdMs > 0 ? Math.max(1, Math.floor(holdMs / bucketMs)) : 0
  const found: HistoryPoint[] = []
  for (const [index, one] of sorted.entries()) {
    found.push(one)
    const next = sorted[index + 1]
    const nextAt = next?.t ?? toMs
    const missing = Math.round((nextAt - one.t) / bucketMs) - 1
    const held = Math.min(Math.max(missing, 0), holdBuckets)
    for (let step = 1; step <= held; step += 1) {
      found.push({ t: one.t + step * bucketMs, v: one.v })
    }
    // ⚠ 断档只画在两条真实读数之间：末尾那一段后面本来就没东西可连，多插一个
    // null 只是让曲线早一格结束，看不出任何区别
    if (next !== undefined && held < missing) {
      found.push({ t: one.t + (held + 1) * bucketMs, v: null })
    }
  }
  return found
}
