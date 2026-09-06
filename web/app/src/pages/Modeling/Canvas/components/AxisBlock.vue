<script setup lang="ts">
/**
 * @fileoverview `axis` 块的画法：时间轴被怎么动了——实际覆盖与断档、请求区间与
 * 实际区间的并排、切分两段的先后、每折的训练段与测试段、以及窗口示意。
 * 服务取数、重采样、切分、滞后、滚动、交叉验证、时间特征这几个算子（规格 §5）。
 *
 * ⚠ 桶宽与时区必须一起印：按 UTC 与按东八区切出来的两条轴长得一模一样，而每
 * 一格里的数差了 8 小时，两边都不报错。
 * ⚠ 折布局与窗口示意量的是**行序**不是时刻：当成毫秒画出来会是 1970 年的一
 * 瞬间。窗口示意的 payload 自带 `scale: "index"`，折布局没带，靠它自己那两个
 * `test_since`/`test_until` 认出来。
 */
import { formatLocalMinute } from '@dt/ui'
import { computed } from 'vue'

import type {
  TimelineRow,
  TimelineScale,
  TimelineSegment,
  TimelineTone,
} from '../scripts/timelineGeometry'
import { grouped, niceNumber, percentText } from '../scripts/numbers'
import type { ReportBlock } from '../scripts/reportBlocks'
import { axisOf } from '../scripts/reportBlocks'

import BlockNotes from './BlockNotes.vue'
import TimelineBand from './TimelineBand.vue'

const props = defineProps<{ block: ReportBlock }>()

// 后端 `reporting.py` 的两个硬上限：触到了界面要说清还有没画出来的（§2-P5）
const MAX_GAPS = 20
const MAX_SEGMENTS = 20

const TONES: readonly TimelineTone[] = [
  'primary',
  'secondary',
  'requested',
  'shuffled',
]

/** 认不出的档一律当主段：宁可多画一条实条，也不许把一段悄悄丢掉。 */
function toneOf(text: string): TimelineTone {
  return TONES.find((one) => one === text) ?? 'primary'
}

function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** RFC3339 → 毫秒。⚠ 后端给的一律是 UTC，读不出来就是 null，不拿 0 顶。 */
function momentOf(text: string | null): number | null {
  if (text === null) return null
  const at = Date.parse(text)
  return Number.isFinite(at) ? at : null
}

/** 一段：时间轴上的段与折布局的段共用这一份读法。 */
interface SegmentRead {
  since: number | null
  until: number | null
  label: string
  tone: TimelineTone
  name: string
  testSince: number | null
  testUntil: number | null
}

function readSegments(
  items: readonly Record<string, unknown>[],
): SegmentRead[] {
  return items.map((item) => ({
    since: numberOf(item['since']),
    until: numberOf(item['until']),
    label: textOf(item['label']),
    tone: toneOf(textOf(item['tone'])),
    name: textOf(item['name']),
    testSince: numberOf(item['test_since']),
    testUntil: numberOf(item['test_until']),
  }))
}

const axis = computed(() => axisOf(props.block.payload))

const segments = computed(() => readSegments(axis.value.segments))

const gaps = computed(() => readSegments(axis.value.gaps))

/** 断档一共缺了多少行。⚠ 读不出来的那一段按 0 计，只影响这句话不影响画。 */
const missing = computed(() =>
  axis.value.gaps.reduce(
    (sum, item) => sum + (numberOf(item['missing']) ?? 0),
    0,
  ),
)

/** 一折：训练段与测试段都按行序给。 */
interface FoldRow {
  name: string
  since: number
  until: number
  testSince: number
  testUntil: number
}

const folds = computed<FoldRow[]>(() => {
  const made: FoldRow[] = []
  for (const one of segments.value) {
    const { since, until, testSince, testUntil } = one
    if (since === null || until === null) continue
    if (testSince === null || testUntil === null) continue
    made.push({
      name: one.name === '' ? one.label : one.name,
      since,
      until,
      testSince,
      testUntil,
    })
  }
  return made
})

/** 折布局的横轴量的是行序：payload 没带 `scale`，靠折自己的形状认。 */
const scale = computed<TimelineScale>(() =>
  textOf(props.block.payload['scale']) === 'index' || folds.value.length > 0
    ? 'index'
    : 'time',
)

const sinceMs = computed(() => momentOf(axis.value.actualSince))
const untilMs = computed(() => momentOf(axis.value.actualUntil))

/** 实际覆盖的那几段：整段挖掉断档，空出来的由时间带自己画成交叉散列。 */
const coverRow = computed<TimelineRow | null>(() => {
  const since = sinceMs.value
  const until = untilMs.value
  if (scale.value !== 'time' || since === null || until === null) return null
  // ⚠ 没有占用率也没有断档时不画这条带：那一档（时区口径）只知道两个端点，
  // 铺一条实心条会把「不知道中间有没有数据」画成「整段都有」
  if (axis.value.occupancy.length === 0 && gaps.value.length === 0) return null
  const holes = gaps.value
    .filter((one) => one.since !== null && one.until !== null)
    .map((one) => ({ since: one.since ?? 0, until: one.until ?? 0 }))
    .sort((left, right) => left.since - right.since)
  const made: TimelineSegment[] = []
  let cursor = since
  for (const hole of holes) {
    const to = Math.min(hole.until, until)
    if (to <= cursor) continue
    const from = Math.max(hole.since, cursor)
    if (from > cursor) {
      made.push({
        since: cursor,
        until: from,
        label: '有数据',
        tone: 'primary',
      })
    }
    cursor = to
  }
  if (cursor < until) {
    made.push({ since: cursor, until, label: '有数据', tone: 'primary' })
  }
  return { name: '实际覆盖', segments: made, showGaps: true }
})

const requested = computed(() =>
  segments.value.filter(
    (one) =>
      one.tone === 'requested' && one.since !== null && one.until !== null,
  ),
)

/** 轴至少要盖住请求区间：不盖住的话「实际比请求短了多少」根本看不出来。 */
const span = computed<{ low: number; high: number } | null>(() => {
  const found = requested.value
  if (found.length === 0 || scale.value !== 'time') return null
  const lows = found.map((one) => one.since ?? 0)
  const highs = found.map((one) => one.until ?? 0)
  return { low: Math.min(...lows), high: Math.max(...highs) }
})

function laid(found: readonly SegmentRead[]): TimelineSegment[] {
  const made: TimelineSegment[] = []
  for (const one of found) {
    if (one.since === null || one.until === null) continue
    made.push({
      since: one.since,
      until: one.until,
      label: one.label === '' ? '一段' : one.label,
      tone: one.tone,
    })
  }
  return made
}

const rows = computed<TimelineRow[]>(() => {
  if (folds.value.length > 0) {
    return folds.value.map((fold) => ({
      name: fold.name === '' ? '一折' : fold.name,
      segments: [
        {
          since: fold.since,
          until: fold.until,
          label: '训练段',
          tone: 'primary',
        },
        {
          since: fold.testSince,
          until: fold.testUntil,
          label: '测试段',
          tone: 'secondary',
        },
      ],
    }))
  }
  const made: TimelineRow[] = []
  const cover = coverRow.value
  if (cover !== null && cover.segments.length > 0) made.push(cover)
  const asked = laid(requested.value)
  if (asked.length > 0) made.push({ name: '请求区间', segments: asked })
  const rest = laid(segments.value.filter((one) => one.tone !== 'requested'))
  if (rest.length > 0) {
    made.push({
      name: scale.value === 'index' ? '窗口' : '区段',
      segments: rest,
    })
  }
  return made
})

/** 毫秒折成人话的档位，从大到小挑第一个装得下的。 */
const UNITS: readonly { ms: number; name: string }[] = [
  { ms: 86_400_000, name: '天' },
  { ms: 3_600_000, name: '小时' },
  { ms: 60_000, name: '分钟' },
  { ms: 1000, name: '秒' },
]

function spanText(ms: number): string {
  const size = Math.abs(ms)
  const unit = UNITS.find((one) => size >= one.ms)
  if (unit === undefined) return `${grouped(Math.round(size))} 毫秒`
  return `${niceNumber(Math.round((size / unit.ms) * 100) / 100)} ${unit.name}`
}

/** 时区偏移印成 `UTC+08:00`。⚠ 这是**业务**时区，不是看图这台机器的时区。 */
function tzText(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+'
  const size = Math.abs(minutes)
  const hours = String(Math.floor(size / 60)).padStart(2, '0')
  return `UTC${sign}${hours}:${String(size % 60).padStart(2, '0')}`
}

/** 折的先后：每一折是不是都拿测试段之前的行训的。 */
function foldNote(found: readonly FoldRow[]): string {
  const forward = found.every((fold) => fold.testSince >= fold.until)
  return forward
    ? `${grouped(found.length)} 折都是拿测试段之前的行训的（前向链）。`
    : `${grouped(found.length)} 折里有测试段落在自己的训练段里，那一折的分数偏高。`
}

/** 切分两段的先后：这是切分那一屏最要紧的一个问题（规格 §5 的 split_dataset）。 */
function splitNote(found: readonly SegmentRead[]): string {
  if (found.some((one) => one.tone === 'shuffled')) {
    return '两段是随机打乱切出来的，时间上互相交错。'
  }
  const trained = found.find((one) => one.tone === 'primary')?.until ?? null
  const tested = found.find((one) => one.tone === 'secondary')?.since ?? null
  if (trained === null || tested === null) return ''
  return tested >= trained
    ? `测试段整段在训练段之后，最早的一行是 ${formatLocalMinute(tested)}（本机时区）。`
    : `测试段与训练段在时间上重叠，最早的一行 ${formatLocalMinute(tested)} 落在训练段里。`
}

/**
 * 两段的先后。
 * ⚠ 只在按时刻量的那条轴上问：窗口示意的段量的是行序，拿去印时刻会印出
 * 1970 年的一瞬间，而那两个数本身完全正常。
 */
const orderNote = computed(() => {
  if (folds.value.length > 0) return foldNote(folds.value)
  return scale.value === 'time' ? splitNote(segments.value) : ''
})

/** 桶宽与时区：两者必须一起说，只说一个的那条轴读不出每一格里是什么。 */
function bucketFact(bucketMs: number | null, minutes: number): string {
  if (bucketMs !== null) {
    return `每 ${spanText(bucketMs)}一个桶（${grouped(bucketMs)} 毫秒），按业务时区 ${tzText(minutes)} 切。`
  }
  return `业务时区 ${tzText(minutes)}。`
}

/** 实际覆盖到哪一段。⚠ 后端给的是 UTC，图上按本机时区显示，这里必须写明。 */
function coverFact(since: number | null, until: number | null): string {
  return since === null || until === null
    ? '这一步没有说明实际覆盖到哪一段。'
    : `实际覆盖 ${formatLocalMinute(since)} ~ ${formatLocalMinute(until)}（本机时区显示，后端给的是 UTC）。`
}

/** 请求的那一段，以及实际起点比它晚了多少——触顶时两者差得很远。 */
function askedFact(
  asked: { low: number; high: number },
  since: number | null,
): string {
  const late =
    since === null || since <= asked.low
      ? ''
      : `，实际起点比请求的晚了 ${spanText(since - asked.low)}`
  return `请求的是 ${formatLocalMinute(asked.low)} ~ ${formatLocalMinute(asked.high)}${late}。`
}

/** 断档那一句：没有断档也要明说，「没画」与「没有」在图上分不出来。 */
function gapFact(holes: number, lost: number, hasOccupancy: boolean): string {
  if (holes > 0) {
    return `${grouped(holes)} 段断档${lost > 0 ? `，合计缺 ${grouped(lost)} 行` : ''}。`
  }
  return hasOccupancy ? '整段没有断档。' : ''
}

/**
 * 这一块到底说没说时间轴上的事。
 * ⚠ 一项都没有时连时区都不许印：`tz_offset_minutes` 缺省是 0，照印会把「没说」
 * 讲成「按 UTC 切的」（规格 §2-P4）。
 */
const hasTime = computed(() => {
  const { bucketMs, occupancy } = axis.value
  return (
    bucketMs !== null ||
    sinceMs.value !== null ||
    untilMs.value !== null ||
    occupancy.length > 0 ||
    segments.value.length > 0 ||
    gaps.value.length > 0
  )
})

/** 图下那几行照实说的事：桶宽、时区、覆盖、请求对实际、断档、占用率。 */
const facts = computed<string[]>(() => {
  if (!hasTime.value) return ['这一步没有说明时间轴上的任何一项。']
  const made: string[] = []
  const { bucketMs, tzOffsetMinutes, occupancy } = axis.value
  if (bucketMs !== null || scale.value === 'time') {
    made.push(bucketFact(bucketMs, tzOffsetMinutes))
  }
  if (scale.value === 'time') {
    made.push(coverFact(sinceMs.value, untilMs.value))
  }
  const asked = span.value
  if (asked !== null) made.push(askedFact(asked, sinceMs.value))
  const gapped = gapFact(gaps.value.length, missing.value, occupancy.length > 0)
  if (gapped !== '') made.push(gapped)
  if (occupancy.length > 0) {
    const mean = occupancy.reduce((sum, one) => sum + one, 0) / occupancy.length
    made.push(`平均占用率 ${percentText(mean * 100)}（按中位采集间隔折算）。`)
  }
  if (orderNote.value !== '') made.push(orderNote.value)
  return made
})

/** 触到上限的那两句：漏画了段而不说，读者会以为断档就这么几处。 */
const limits = computed<string[]>(() => {
  const made: string[] = []
  if (gaps.value.length >= MAX_GAPS) {
    made.push(
      `断档最多列 ${MAX_GAPS} 段，这一块已经列满，可能还有没画出来的断档。`,
    )
  }
  if (segments.value.length >= MAX_SEGMENTS) {
    made.push(
      `区段最多列 ${MAX_SEGMENTS} 段，这一块已经列满，可能还有没画出来的段。`,
    )
  }
  return made
})
</script>

<template>
  <section class="dt-ml-axis">
    <p class="dt-ml-axis__title">{{ props.block.title }}</p>
    <TimelineBand
      v-if="rows.length > 0"
      :rows="rows"
      :scale="scale"
      :span="span"
    />
    <p v-for="text in facts" :key="text" class="dt-ml-axis__fact">{{ text }}</p>
    <p v-for="text in limits" :key="text" class="dt-ml-axis__limit">
      {{ text }}
    </p>
    <BlockNotes :payload="props.block.payload" />
  </section>
</template>

<style scoped lang="scss">
.dt-ml-axis {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;

  &__title {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--ctl-hint-fs-md);
    font-weight: 600;
  }

  &__fact,
  &__limit {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }

  // 截断这一句要看得见：漏画的段与「本来就没有」在图上分不出来
  &__limit {
    color: var(--text-primary);
  }
}
</style>
