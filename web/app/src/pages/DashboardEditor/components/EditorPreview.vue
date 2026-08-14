<script setup lang="ts">
/**
 * @fileoverview 编辑器内的全屏预览：把**当前草稿**按运行态口径整屏渲染。
 * 挂在编辑器组件树内而不 Teleport——页面注入的取数读取器与联动引擎要顺着
 * 组件树流下来，预览里才有活值。
 */
import type { DashboardNodePayload } from '@dt/contracts'
import {
  NodeTree,
  buildNodeTree,
  computeStageGeometry,
  mergeCardChrome,
  type DesignSize,
  type GetModuleManifest,
} from '@dt/runtime'
import { DtButton } from '@dt/ui'
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  type CSSProperties,
} from 'vue'

const props = defineProps<{
  nodes: readonly DashboardNodePayload[]
  design: DesignSize
  getManifest: GetModuleManifest
  /** 页面级外观袋（草稿态），取里面的 card 段做卡片缺省。 */
  chromeJson: Record<string, unknown>
}>()

const emit = defineEmits<{ close: [] }>()

const tree = computed(() => buildNodeTree(props.nodes, props.getManifest))
const cardChrome = computed(() => mergeCardChrome(props.chromeJson.card, null))

const host = ref<HTMLElement | null>(null)
const viewport = ref({ width: 0, height: 0 })
let observer: ResizeObserver | null = null

const stage = computed(() => computeStageGeometry(viewport.value, props.design))

const stageStyle = computed<CSSProperties>(() => ({
  width: `${props.design.width}px`,
  height: `${props.design.height}px`,
  transform: `translate(${stage.value.offsetX}px, ${stage.value.offsetY}px) scale(${stage.value.scale})`,
  transformOrigin: 'top left',
}))

onMounted(() => {
  observer = new ResizeObserver((entries) => {
    const box = entries[0]?.contentRect
    if (box) viewport.value = { width: box.width, height: box.height }
  })
  if (host.value) observer.observe(host.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})
</script>

<template>
  <div
    ref="host"
    class="fixed inset-0 z-50 overflow-hidden bg-surface-base"
    role="dialog"
    aria-modal="true"
    aria-label="预览"
  >
    <div :style="stageStyle">
      <NodeTree
        :nodes="tree.roots"
        :design="design"
        :get-manifest="getManifest"
        :card-chrome="cardChrome"
      />
    </div>

    <div class="absolute right-4 top-4">
      <DtButton
        size="sm"
        variant="soft"
        icon="close"
        data-test="close-preview"
        @click="emit('close')"
      >
        退出预览
      </DtButton>
    </div>
  </div>
</template>
