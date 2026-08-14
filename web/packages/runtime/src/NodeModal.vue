<script setup lang="ts">
/**
 * @fileoverview 节点弹窗浮层：联动 `openModal` 的渲染端。内容 = 目标节点连同
 * 整棵子树，复用 NodeTree，面板尺寸即该节点在画布上的原始宽高。
 * 渲染在舞台内部而不用 DtModal——后者恒 Teleport 到 body，会丢掉注在舞台元素上
 * 的主题变量，也不跟着舞台的等比缩放走。
 * ⚠ 遮罩吞指针但**不**点击关闭：大屏常配触摸屏值班台，误触关掉明细很烦人，
 * 退路只有右上角关闭键与 Esc。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import type { DashboardNodeView } from '@dt/contracts'

import NodeTree from './NodeTree.vue'
import { buildModalSubtree, type GetModuleManifest } from './nodeTree'
import type { DesignSize } from './dashboardGeometry'

const props = defineProps<{
  /** 整张节点表，本组件自行裁出目标子树。 */
  nodes: readonly DashboardNodeView[]
  /** 弹窗内容根节点 id。 */
  rootId: string
  /** 留空 = 不渲染标题栏。 */
  title?: string
  /** 舞台设计尺寸，把面板钳在舞台内。 */
  design: DesignSize
  getManifest: GetModuleManifest
}>()

const emit = defineEmits<{ close: [] }>()

/** 面板四周至少留出的舞台边距（设计像素）。 */
const STAGE_MARGIN = 48
/** 标题栏高度，用于扣减内容区可用高。 */
const TITLE_H = 40

const autoId = useId()
const titleId = computed(() => `dt-node-modal-${autoId}-title`)

const subtree = computed(() =>
  buildModalSubtree(props.nodes, props.rootId, props.getManifest),
)
const root = computed(() => subtree.value[0] ?? null)
const hasTitle = computed(() => (props.title ?? '') !== '')

// 内容区 = 内容节点自身宽高钳到舞台可用区；钳小时裁掉超出部分——
// 把面板顶出舞台看不见，比裁掉底部更糟
const contentStyle = computed(() => {
  const box = root.value?.box
  if (box === undefined) return { width: '0px', height: '0px' }
  const maxW = Math.max(120, props.design.width - STAGE_MARGIN * 2)
  const maxH = Math.max(
    120,
    props.design.height - STAGE_MARGIN * 2 - (hasTitle.value ? TITLE_H : 0),
  )
  return {
    width: `${Math.min(box.w, maxW)}px`,
    height: `${Math.min(box.h, maxH)}px`,
  }
})

const contentDesign = computed<DesignSize>(() => ({
  width: root.value?.box.w ?? 0,
  height: root.value?.box.h ?? 0,
}))

const panelRef = ref<HTMLElement | null>(null)
let previouslyFocused: HTMLElement | null = null

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusables(): HTMLElement[] {
  const panel = panelRef.value
  if (panel === null) return []
  return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.offsetParent !== null || element === panel,
  )
}

/** Tab 把焦点圈在面板内：走到头就折返，面板本身也算头。 */
function trapTab(event: KeyboardEvent): void {
  const list = focusables()
  if (list.length === 0) {
    event.preventDefault()
    panelRef.value?.focus()
    return
  }
  const first = list[0]
  const last = list[list.length - 1]
  const active = document.activeElement
  const atEdge = event.shiftKey
    ? active === first || active === panelRef.value
    : active === last
  if (!atEdge) return
  event.preventDefault()
  const wrapTo = event.shiftKey ? last : first
  wrapTo?.focus()
}

/** Esc 关闭；Tab 圈焦点，键盘到不了背后的大屏。 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
    return
  }
  if (event.key === 'Tab') trapTab(event)
}

onMounted(async () => {
  previouslyFocused =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  await nextTick()
  panelRef.value?.focus()
})

onBeforeUnmount(() => {
  // 焦点归还触发元素，键盘用户不被甩回文档开头
  previouslyFocused?.focus()
})
</script>

<template>
  <div
    v-if="root"
    class="dt-node-modal"
    role="dialog"
    aria-modal="true"
    :aria-labelledby="hasTitle ? titleId : undefined"
    :aria-label="hasTitle ? undefined : '详情'"
    @keydown="onKeydown"
  >
    <div class="dt-node-modal__backdrop" aria-hidden="true" />

    <div ref="panelRef" class="dt-node-modal__panel" tabindex="-1">
      <div v-if="hasTitle" class="dt-node-modal__head">
        <span :id="titleId" class="dt-node-modal__title">{{ title }}</span>
      </div>
      <button
        type="button"
        class="dt-node-modal__close"
        :class="{ 'dt-node-modal__close--bare': !hasTitle }"
        aria-label="关闭"
        @click="emit('close')"
      >
        ✕
      </button>

      <div class="dt-node-modal__body" :style="contentStyle">
        <NodeTree
          :nodes="subtree"
          :design="contentDesign"
          :get-manifest="getManifest"
          root-always-visible
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 浮层铺满舞台（舞台是定位上下文）；z-index 只需压过节点的 zIndex 量级 */
.dt-node-modal {
  position: absolute;
  inset: 0;
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 遮罩：虚化 + 压暗，让背后的大屏明确退到不可操作的一层。
   没有 @click——吞掉指针事件正是它的职责 */
.dt-node-modal__backdrop {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--surface-base) 45%, transparent);
  backdrop-filter: blur(8px) saturate(0.85);
  animation: dt-node-modal-fade 0.18s ease both;
}

/* 不支持 backdrop-filter 的环境靠加厚底色达到同样的隔离观感 */
@supports not (backdrop-filter: blur(1px)) {
  .dt-node-modal__backdrop {
    background: color-mix(in srgb, var(--surface-base) 88%, transparent);
  }
}

.dt-node-modal__panel {
  position: relative;
  display: flex;
  flex-direction: column;
  max-width: 100%;
  max-height: 100%;
  border: 1px solid var(--border-hover);
  border-radius: var(--radius-md);
  background: var(--surface-panel);
  box-shadow: var(--fx-shadow-modal);
  animation: dt-node-modal-rise 0.2s ease both;
}

.dt-node-modal__panel:focus {
  outline: none;
}

.dt-node-modal__head {
  display: flex;
  align-items: center;
  height: 40px;
  padding: 0 44px 0 16px;
  border-bottom: 1px solid var(--border-subtle);
}

.dt-node-modal__title {
  overflow: hidden;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-title);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dt-node-modal__close {
  position: absolute;
  top: 8px;
  right: 10px;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  font-size: 12px;
  line-height: 1;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  transition:
    color 0.15s ease,
    background 0.15s ease;
}

/* 无标题栏时关闭键浮在内容上，垫一层底免得压在深浅不一的内容上看不清 */
.dt-node-modal__close--bare {
  background: color-mix(in srgb, var(--surface-panel) 82%, transparent);
}

.dt-node-modal__close:hover {
  color: var(--text-title);
  background: color-mix(in srgb, var(--accent-primary) 14%, transparent);
}

.dt-node-modal__close:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 1px;
}

/* 内容区是 NodeTree 的绝对定位基准；超出裁断，绝不顶出舞台 */
.dt-node-modal__body {
  position: relative;
  overflow: hidden;
  border-radius: 0 0 var(--radius-md) var(--radius-md);
}

@keyframes dt-node-modal-fade {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

@keyframes dt-node-modal-rise {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.985);
  }

  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .dt-node-modal__backdrop,
  .dt-node-modal__panel {
    animation: none;
  }
}
</style>
