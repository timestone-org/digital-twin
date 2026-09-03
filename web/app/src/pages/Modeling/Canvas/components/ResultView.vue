<script setup lang="ts">
/**
 * @fileoverview 结果视图的派发件。**只认 `kind`**，见 `scripts/preview.ts` 文件头。
 *
 * ⚠ 一个节点可以有**多路输出**：切分给训练集与测试集、回归给模型与打分。摘要
 * 因此按端口建键，这里逐端口摆开而不是只挑一路——只显示第一路的话，「测试集
 * 到底切了多少行」在界面上根本看不到。
 */
import { DtEmpty } from '@dt/ui'
import { computed } from 'vue'

import { modelingFrameUrl } from '@/api/modeling'

import { portPreviewsOf } from '../scripts/preview'

import FrameView from './FrameView.vue'
import MetricsView from './MetricsView.vue'
import ModelView from './ModelView.vue'

const props = defineProps<{
  payload: Record<string, unknown>
  /** 端口名 → 算子声明的中文标签。取不到就退回端口名本身。 */
  labels?: Record<string, string>
  /** 这次运行的 id 与这个节点的 id，只用来拼下载地址。 */
  runId?: string
  nodeId?: string
  /**
   * 留下了全量结果的那些端口。
   *
   * ⚠ 摘要那一份**有硬上限**（200 行）：它是给人看一眼的，不是数据。想把处理
   * 好的数据拿走走这个链接，且它要另一个权限码
   * （docs/MODELING_PLATFORM_DESIGN.md D12）。
   */
  exportedPorts?: readonly string[]
}>()

const ports = computed(() => portPreviewsOf(props.payload))

/** 只有一路输出时不摆小标题——那时标题只是重复卡片名。 */
const isLabelled = computed(() => ports.value.length > 1)

function labelOf(port: string): string {
  return props.labels?.[port] ?? port
}

/** 这一路有没有全量结果可下；没有就不摆那个链接。 */
function downloadOf(port: string): string {
  const runId = props.runId
  const nodeId = props.nodeId
  if (runId === undefined || nodeId === undefined) return ''
  if (!(props.exportedPorts ?? []).includes(port)) return ''
  return modelingFrameUrl(runId, nodeId, port)
}
</script>

<template>
  <DtEmpty v-if="ports.length === 0" title="这一步没有可展示的结果" />
  <div v-else class="dt-ml-result">
    <section v-for="item in ports" :key="item.port">
      <header
        v-if="isLabelled || downloadOf(item.port)"
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
      <FrameView v-if="item.preview.kind === 'frame'" :preview="item.preview" />
      <ModelView
        v-else-if="item.preview.kind === 'model'"
        :preview="item.preview"
      />
      <MetricsView
        v-else-if="item.preview.kind === 'metrics'"
        :preview="item.preview"
      />
      <DtEmpty v-else :title="item.preview.note" />
    </section>
  </div>
</template>

<style scoped lang="scss">
.dt-ml-result {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;

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
}
</style>
