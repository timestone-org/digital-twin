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

import { portPreviewsOf } from '../scripts/preview'

import FrameView from './FrameView.vue'
import MetricsView from './MetricsView.vue'
import ModelView from './ModelView.vue'

const props = defineProps<{
  payload: Record<string, unknown>
  /** 端口名 → 算子声明的中文标签。取不到就退回端口名本身。 */
  labels?: Record<string, string>
}>()

const ports = computed(() => portPreviewsOf(props.payload))

/** 只有一路输出时不摆小标题——那时标题只是重复卡片名。 */
const isLabelled = computed(() => ports.value.length > 1)

function labelOf(port: string): string {
  return props.labels?.[port] ?? port
}
</script>

<template>
  <DtEmpty v-if="ports.length === 0" title="这一步没有可展示的结果" />
  <div v-else class="dt-ml-result">
    <section v-for="item in ports" :key="item.port">
      <h4 v-if="isLabelled" class="dt-ml-result__port">
        {{ labelOf(item.port) }}
      </h4>
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

  &__port {
    margin: 0 0 0.5rem;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
    font-weight: 600;
  }
}
</style>
