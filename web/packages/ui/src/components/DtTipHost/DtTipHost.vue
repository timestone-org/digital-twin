<script setup lang="ts">
/**
 * @fileoverview 全局提示气泡宿主：接管原生 `title`，改用本项目的气泡画出来。
 * 全应用挂一次（App.vue），业务侧什么都不用做。
 *
 * ⚠ 走「接管」而不是逐处改写模板：全仓一百多处 title 散在几十个文件里，且多半挂在
 * DtButton / RouterLink 这类把原生属性透传下去的组件上，逐处包一层 DtTooltip 会改
 * DOM 结构、连带影响布局与既有断言。接管只在悬停/聚焦那一刻把 title 摘下来，收起时
 * 原样装回去——静止态的 DOM 与无障碍树跟没有这个宿主时一模一样。
 *
 * ⚠ 摘的时机是指针一进来，不是气泡真正弹出的时候：系统气泡自己有约 1 秒的延时，
 * 等到弹出时才摘就已经晚了，两只气泡会一起出现。
 */
import { onBeforeUnmount, onMounted, ref, useId } from 'vue'

import { useAnchoredOverlay } from '../../overlay/useAnchoredOverlay'
import {
  anchorOf,
  holdTitle,
  pointOf,
  releaseTitle,
  type HeldTitle,
} from './nativeTitle'

const props = withDefaults(
  defineProps<{
    /** 悬停多久才弹，毫秒。0 = 立刻弹（测试用）。 */
    delay?: number
  }>(),
  { delay: 350 },
)

const tipId = `dt-tip-${useId()}`

const anchor = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const text = ref('')

const overlay = useAnchoredOverlay({
  trigger: anchor,
  panel,
  side: () => 'top',
  align: () => 'center',
  // ⚠ 点外面不收：提示靠移开指针收，外点收会让它在滚动条上一点就消失（同 DtTooltip）
  onOutside: () => undefined,
})
const { host, style, side: placedSide, arrowOffset } = overlay

/** 此刻被摘下来的 title；收起时要原样装回去。 */
let held: HeldTitle | null = null
let timer = 0
/** title 会被 Vue 重渲染写回来，写回来就得再摘一次，否则系统气泡又出来了。 */
let watcher: MutationObserver | null = null
/** aria-describedby 是这个宿主挂上去的（元素本来就有的那份不许动）。 */
let ownsDescribedby = false

function reveal(): void {
  timer = 0
  const el = anchor.value
  if (el === null || !el.isConnected) {
    hide()
    return
  }
  ownsDescribedby = !el.hasAttribute('aria-describedby')
  if (ownsDescribedby) el.setAttribute('aria-describedby', tipId)
  overlay.open()
}

function show(el: HTMLElement): void {
  if (el === anchor.value) return
  hide()
  const next = holdTitle(el)
  if (next === null) return
  held = next
  text.value = next.text
  anchor.value = el
  watcher = new MutationObserver(regrab)
  watcher.observe(el, { attributes: true, attributeFilter: ['title'] })
  if (props.delay <= 0) reveal()
  else timer = window.setTimeout(reveal, props.delay)
}

function hide(): void {
  if (timer !== 0) window.clearTimeout(timer)
  timer = 0
  watcher?.disconnect()
  watcher = null
  const el = anchor.value
  if (el !== null && ownsDescribedby) el.removeAttribute('aria-describedby')
  ownsDescribedby = false
  overlay.close()
  anchor.value = null
  text.value = ''
  releaseTitle(held)
  held = null
}

function regrab(): void {
  if (held === null) return
  const next = holdTitle(held.el)
  if (next === null) return
  held = next
  text.value = next.text
}

function track(event: Event): void {
  const target = event.target instanceof Element ? event.target : null
  // ⚠ 先按 event.target 认，认不出来才做命中测试：命中测试会强制一次布局，
  // 而指针扫过一张长表会一行一次地把它打满
  const next =
    anchorOf(target, held?.el ?? null) ?? anchorOf(pointOf(event), null)
  if (next === null) hide()
  else show(next)
}

function onKeydown(event: KeyboardEvent): void {
  // WCAG 要求悬浮内容可消除
  if (event.key === 'Escape') hide()
}

onMounted(() => {
  // ⚠ 一律 capture：拖拽类组件会对指针事件 stopPropagation，冒泡阶段收不全
  document.addEventListener('pointerover', track, true)
  document.addEventListener('focusin', track, true)
  document.addEventListener('focusout', hide, true)
  document.addEventListener('keydown', onKeydown, true)
  // 指针整个移出窗口时不会再有 pointerover，得单独收一次
  document.documentElement.addEventListener('pointerleave', hide)
})

onBeforeUnmount(() => {
  hide()
  document.removeEventListener('pointerover', track, true)
  document.removeEventListener('focusin', track, true)
  document.removeEventListener('focusout', hide, true)
  document.removeEventListener('keydown', onKeydown, true)
  document.documentElement.removeEventListener('pointerleave', hide)
})
</script>

<template>
  <Teleport v-if="overlay.isOpen.value" :to="host">
    <span
      :id="tipId"
      ref="panel"
      class="dt-tip"
      :class="`dt-tip--${placedSide}`"
      role="tooltip"
      :style="{ ...style, '--_arrow': `${arrowOffset}px` }"
      >{{ text }}</span
    >
  </Teleport>
</template>

<style scoped lang="scss">
@use '../../styles/bubble' as bubble;

.dt-tip {
  display: block;
  max-width: 18rem;
  width: max-content;
  padding: 6px 10px;
  font-family: var(--font-sans);
  font-size: var(--ctl-hint-fs-lg);
  line-height: 1.4;
  overflow-wrap: break-word;
  // 气泡不接指针事件，否则它会挡住触发器、把移出提前触发成闪烁
  pointer-events: none;

  @include bubble.bubble-surface;
  @include bubble.bubble-arrow;
}
</style>
