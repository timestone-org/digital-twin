<script setup lang="ts">
/**
 * @fileoverview 编辑器内的全屏预览：把**当前草稿**按运行态口径整屏渲染。
 * 挂在编辑器组件树内而不 Teleport——页面注入的取数读取器要顺着组件树流下来，
 * 预览里才有活值；联动引擎由本组件自己装（`usePreviewInteraction`），
 * 因为它只能作用在这一棵子树上，不能让设计态画布也跟着跑联动。
 */
import type { DashboardNodePayload } from '@dt/contracts'
import {
  NodeModal,
  NodeTree,
  buildNodeTree,
  computeStageGeometry,
  mergeCardChrome,
  type DesignSize,
  type GetModuleManifest,
} from '@dt/runtime'
import { DtButton, DtNotice } from '@dt/ui'
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  type CSSProperties,
} from 'vue'

import { usePreviewInteraction } from '../scripts/usePreviewInteraction'

const props = defineProps<{
  nodes: readonly DashboardNodePayload[]
  design: DesignSize
  getManifest: GetModuleManifest
  /** 页面级外观袋（草稿态），取里面的 card 段做卡片缺省、interactions 段做联动。 */
  chromeJson: Record<string, unknown>
  /** 正在编辑的这张屏；页签栏靠它认出「当前在哪一格」。 */
  dashboardId: string
}>()

const emit = defineEmits<{ close: [] }>()

const tree = computed(() => buildNodeTree(props.nodes, props.getManifest))
const cardChrome = computed(() => mergeCardChrome(props.chromeJson.card, null))

// 预览按运行态跑联动：显隐、互斥切换与弹窗都当真，只有跨屏跳转换成一句提示
const interaction = usePreviewInteraction({
  nodes: () => props.nodes,
  chromeJson: () => props.chromeJson,
  dashboardId: () => props.dashboardId,
})

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
      <NodeModal
        v-if="interaction.activeModal.value"
        :nodes="nodes"
        :root-id="interaction.activeModal.value.nodeId"
        :title="interaction.activeModal.value.title"
        :design="design"
        :get-manifest="getManifest"
        :card-chrome="cardChrome"
        @close="interaction.closeModal"
      />
    </div>

    <!-- 跨屏跳转在预览里只说不跳；摆在舞台之外，不跟着等比缩放缩成一条看不清的字 -->
    <div
      v-if="interaction.jumpNotice.value !== ''"
      class="absolute left-1/2 top-4 max-w-lg -translate-x-1/2"
      data-test="preview-jump-notice"
    >
      <DtNotice intent="info" icon="alert-circle">
        {{ interaction.jumpNotice.value }}
      </DtNotice>
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
