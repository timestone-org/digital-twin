<script setup lang="ts">
/**
 * @fileoverview 结果面的六区骨架：整屏级截断 → 节点级块 → 逐路的块、完整数据与出处。
 *
 * ⚠ 一个节点可以有**多路输出**：切分给训练集与测试集、回归给模型与打分。摘要
 * 因此按端口建键；多路时用页签一次只摆一路，两路各摆一遍等于把同一份账印两遍。
 * ⚠ 没有讲解的运行（老运行）退回升级前的样子：不摆空区、不折叠、不多说一个字。
 */
import { DtEmpty, DtSegmented } from '@dt/ui'
import type { DtSegmentedOption } from '@dt/contracts'
import { computed, ref } from 'vue'

import { modelingFrameUrl } from '@/api/modeling'

import { grouped } from '../scripts/numbers'
import type { PortPreview } from '../scripts/preview'
import { portPreviewsOf } from '../scripts/preview'
import { axisOf, recordOf, reportOf } from '../scripts/reportBlocks'
import type { ReportZone } from '../scripts/zones'
import {
  LEAD_ZONES,
  TABLE_ZONE,
  ZONE_ORDER,
  ZONE_TITLES,
  blocksOfPort,
} from '../scripts/zones'

import FrameView from './FrameView.vue'
import MetricsView from './MetricsView.vue'
import ModelView from './ModelView.vue'
import ProvenanceBar from './ProvenanceBar.vue'
import ReportBlocks from './ReportBlocks.vue'
import TruncationNotice from './TruncationNotice.vue'
import UnknownView from './UnknownView.vue'

const props = defineProps<{
  payload: Record<string, unknown>
  /** 端口名 → 算子声明的中文标签。取不到就退回端口名本身。 */
  labels?: Record<string, string> | undefined
  /**
   * 这次运行的 id 与这个节点的 id，只用来拼下载地址。
   *
   * ⚠ 显式写上 `| undefined`：仓里开着 `exactOptionalPropertyTypes`，
   * `?:` 只表示「可以不传」，不表示「可以传 undefined」——而调用点拿到的
   * 恰恰是一个可能为 undefined 的值。
   */
  runId?: string | undefined
  nodeId?: string | undefined
  /**
   * 留下了全量结果的那些端口。
   *
   * ⚠ 摘要那一份**有硬上限**（200 行）：它是给人看一眼的，不是数据。想把处理
   * 好的数据拿走走这个链接，且它要另一个权限码
   * （docs/MODELING_PLATFORM_DESIGN.md D12）。
   */
  exportedPorts?: readonly string[] | undefined
  /** 这一步讲的那些块；null = 这次运行没记。 */
  report?: Record<string, unknown> | null | undefined
  /** 结果摘要撑爆了字节预算，有一部分没存下来。 */
  isPreviewTruncated?: boolean | undefined
}>()

const TABLE_ZONES: readonly ReportZone[] = [TABLE_ZONE]

const ports = computed(() => portPreviewsOf(props.payload))

/** 只有一路输出时不摆小标题——那时标题只是重复卡片名。 */
const isLabelled = computed(() => ports.value.length > 1)

const report = computed(() => reportOf(props.report))

/** 有块才铺六区；一块都没有的运行照升级前的样子渲染（规格 §4.7）。 */
const hasFace = computed(() => report.value.blocks.length > 0)

const activePort = ref('')
const opened = ref(new Set<string>())

function labelOf(port: string): string {
  return props.labels?.[port] ?? port
}

const portOptions = computed<DtSegmentedOption[]>(() =>
  ports.value.map((item) => ({ value: item.port, label: labelOf(item.port) })),
)

/** 页签选中的那一路；选中的端口不在了就退回第一路。 */
const shownPort = computed(() => {
  const all = ports.value
  const picked = all.find((item) => item.port === activePort.value)
  return picked?.port ?? all[0]?.port ?? ''
})

/** 多路输出时一次只渲染一路：两路各摆一遍等于把同一份账印两遍（规格 §3.4）。 */
const shownPorts = computed<PortPreview[]>(() => {
  const all = ports.value
  if (!hasFace.value || all.length < 2) return all
  return all.filter((item) => item.port === shownPort.value)
})

const nodeBlocks = computed(() => blocksOfPort(report.value.blocks, ''))

function portBlocks(port: string) {
  return blocksOfPort(report.value.blocks, port)
}

/** 这一路的取数出处。只有帧才有出处，模型与评估都没有。 */
function provenanceOf(item: PortPreview) {
  return item.preview.kind === 'frame' ? item.preview.provenance : null
}

/** 取数触顶：数据根本没进来，与「摘要削了」是两回事（规格 §2-P5）。 */
const isSourceTruncated = computed(() =>
  ports.value.some((item) => provenanceOf(item)?.isTruncated === true),
)

const isBudgetTrimmed = computed(
  () => props.isPreviewTruncated === true || report.value.dropped.length > 0,
)

/** 各路出处一字不差时只印一次——切分不改出处，印两遍是同一句话说两遍。 */
const isSharedProvenance = computed(() => {
  const marks = ports.value.map((item) => JSON.stringify(provenanceOf(item)))
  const first = marks[0]
  return (
    marks.length > 1 && first !== undefined && marks.every((m) => m === first)
  )
})

/**
 * 实际取到的区间，来自这一路（或节点级）的时间轴块。
 *
 * ⚠ 与请求区间分开：触顶时实际起点比请求起点晚得多（规格 §1.3 D-7）。
 */
function actualSpanOf(port: string) {
  const found = report.value.blocks.find(
    (block) =>
      block.kind === 'axis' && (block.port === port || block.port === ''),
  )
  if (found === undefined) return { since: null, until: null }
  const axis = axisOf(found.payload)
  return { since: axis.actualSince, until: axis.actualUntil }
}

/** 这一路有没有全量结果可下；没有就不摆那个链接。 */
function downloadOf(port: string): string {
  const runId = props.runId
  const nodeId = props.nodeId
  if (runId === undefined || nodeId === undefined) return ''
  if (!(props.exportedPorts ?? []).includes(port)) return ''
  return modelingFrameUrl(runId, nodeId, port)
}

/** 「完整数据（12,480 行 × 8 列）」：点开之前也要知道点开有多少东西。 */
function dataTitleOf(item: PortPreview): string {
  const preview = item.preview
  if (preview.kind !== 'frame') return ZONE_TITLES[TABLE_ZONE]
  const shape = `${grouped(preview.rowCount)} 行 × ${preview.colCount} 列`
  return `${ZONE_TITLES[TABLE_ZONE]}（${shape}）`
}

/** 没有六区时不折叠：那时这张表就是全部内容，收起来等于一片空白。 */
function isOpen(port: string): boolean {
  return !hasFace.value || opened.value.has(port)
}

function toggle(port: string): void {
  const next = new Set(opened.value)
  if (!next.delete(port)) next.add(port)
  opened.value = next
}

interface Anchor {
  key: string
  label: string
  target: string
}

/** 锚点条按 `ZONE_ORDER` 排，且只摆真有内容的区。 */
const anchors = computed<Anchor[]>(() => {
  const found: Anchor[] = []
  for (const zone of ZONE_ORDER) {
    if (zone === TABLE_ZONE) continue
    if (report.value.blocks.some((block) => block.zone === zone)) {
      found.push({
        key: zone,
        label: ZONE_TITLES[zone],
        target: `[data-zone="${zone}"]`,
      })
    }
  }
  found.push({
    key: 'data',
    label: ZONE_TITLES[TABLE_ZONE],
    target: '[data-anchor="data"]',
  })
  return found
})

const rootRef = ref<HTMLElement | null>(null)

function jump(target: string): void {
  const found = rootRef.value?.querySelector(target)
  if (found instanceof HTMLElement) {
    found.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}
</script>

<template>
  <DtEmpty v-if="ports.length === 0" title="这一步没有可展示的结果" />
  <div v-else ref="rootRef" class="dt-ml-result">
    <nav v-if="hasFace" class="dt-ml-result__anchors">
      <button
        v-for="anchor in anchors"
        :key="anchor.key"
        type="button"
        class="dt-ml-result__anchor"
        @click="jump(anchor.target)"
      >
        {{ anchor.label }}
      </button>
    </nav>
    <TruncationNotice v-if="hasFace && isSourceTruncated" kind="source" />
    <TruncationNotice
      v-if="isBudgetTrimmed"
      kind="budget"
      :dropped="report.dropped"
    />
    <ReportBlocks v-if="hasFace" :blocks="nodeBlocks" :zones="LEAD_ZONES" />
    <DtSegmented
      v-if="hasFace && isLabelled"
      :model-value="shownPort"
      :options="portOptions"
      variant="tabs"
      aria-label="这一步的输出"
      @update:model-value="activePort = $event"
    />
    <section v-for="item in shownPorts" :key="item.port">
      <header
        v-if="!hasFace && (isLabelled || downloadOf(item.port))"
        class="dt-ml-result__head"
      >
        <h4 v-if="isLabelled" class="dt-ml-result__port">
          {{ labelOf(item.port) }}
        </h4>
        <!-- ⚠ 用原生 <a download>：一份 CSV 可以到几十 MB，拉回内存再造 blob
             是白付一遍内存，交给浏览器直接下更省也天然带进度 -->
        <a
          v-if="downloadOf(item.port)"
          class="dt-ml-result__download"
          :href="downloadOf(item.port)"
          download
        >
          下载全量结果
        </a>
      </header>
      <ReportBlocks
        v-if="hasFace"
        :blocks="portBlocks(item.port)"
        :zones="LEAD_ZONES"
      />
      <div class="dt-ml-result__data" data-anchor="data">
        <button
          v-if="hasFace"
          type="button"
          class="dt-ml-result__toggle"
          :aria-expanded="isOpen(item.port)"
          @click="toggle(item.port)"
        >
          {{ dataTitleOf(item) }}
        </button>
        <div
          v-if="isOpen(item.port)"
          :class="{ 'dt-ml-result__scroll': hasFace }"
        >
          <ReportBlocks
            v-if="hasFace"
            :blocks="portBlocks(item.port)"
            :zones="TABLE_ZONES"
          />
          <FrameView
            v-if="item.preview.kind === 'frame'"
            :preview="item.preview"
            :has-provenance-bar="hasFace"
          />
          <ModelView
            v-else-if="item.preview.kind === 'model'"
            :preview="item.preview"
          />
          <MetricsView
            v-else-if="item.preview.kind === 'metrics'"
            :preview="item.preview"
          />
          <UnknownView
            v-else
            :note="item.preview.note"
            :raw="recordOf(props.payload[item.port])"
          />
        </div>
      </div>
      <ProvenanceBar
        v-if="hasFace"
        :table-codes="provenanceOf(item)?.tableCodes ?? []"
        :since="provenanceOf(item)?.since ?? null"
        :until="provenanceOf(item)?.until ?? null"
        :actual-since="actualSpanOf(item.port).since"
        :actual-until="actualSpanOf(item.port).until"
        :download-url="downloadOf(item.port)"
      />
      <p v-if="hasFace && isSharedProvenance" class="dt-ml-result__shared">
        各路来自同一次取数，这一步不改出处。
      </p>
    </section>
  </div>
</template>

<style scoped lang="scss">
.dt-ml-result {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;

  section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  &__anchors {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0.25rem 0;
    background: var(--surface-overlay);
  }

  &__anchor {
    padding: 0.125rem 0.5rem;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-md);
    cursor: pointer;

    &:hover {
      border-color: var(--border-hover);
      color: var(--text-primary);
    }
  }

  &__head {
    display: flex;
    gap: 0.75rem;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }

  &__port {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
    font-weight: 600;
  }

  &__download {
    color: var(--accent-primary);
    font-size: var(--ctl-hint-fs-md);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }

  &__data {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  &__toggle {
    align-self: flex-start;
    padding: 0;
    border: none;
    background: none;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-md);
    font-weight: 600;
    cursor: pointer;

    &:hover {
      color: var(--text-primary);
    }
  }

  // ⚠ DtTable 自己没有 max-height：200 行是全高渲染，不套一层内滚整个弹窗会被撑长
  &__scroll {
    max-height: 28rem;
    overflow: auto;
  }

  &__shared {
    margin: 0.25rem 0 0;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }
}
</style>
