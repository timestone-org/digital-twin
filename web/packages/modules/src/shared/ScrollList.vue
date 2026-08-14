<script setup lang="ts">
/**
 * @fileoverview 列表与表格族通用的自动滚动视口：内容超出视口就慢速循环滚动
 * （复制一份内容做无缝衔接），悬停暂停；否则退回原生滚动条。
 * ⚠ 「减少动态」偏好一定要退回**原生滚动**而不是只停动画：视口是 overflow:hidden，
 * 纯停动画会让折叠线以下的条目再也看不到，那是数据被静默截断。
 */
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type CSSProperties,
} from 'vue'

const props = withDefaults(
  defineProps<{
    /** 条目数，用来算一圈滚完要多久。 */
    itemCount: number
    autoScroll?: boolean
    secondsPerItem?: number
  }>(),
  { autoScroll: true, secondsPerItem: 3 },
)

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
// 一圈至少滚这么久，否则条目少时快得看不清
const MIN_DURATION_S = 4
// 量高的容差：亚像素差不算溢出，否则会为了一根头发丝滚个不停
const OVERFLOW_TOLERANCE_PX = 1

const viewportRef = ref<HTMLElement | null>(null)
const copyRef = ref<HTMLElement | null>(null)
const contentHeight = ref(0)
const viewportHeight = ref(0)
const isMotionReduced = ref(false)

let observer: ResizeObserver | null = null
let motionQuery: MediaQueryList | null = null
let measureFrame = 0

function measure(): void {
  contentHeight.value = copyRef.value?.scrollHeight ?? 0
  viewportHeight.value = viewportRef.value?.clientHeight ?? 0
}

function onMotionChange(event: MediaQueryListEvent): void {
  isMotionReduced.value = event.matches
}

const isOverflowing = computed(
  () => contentHeight.value > viewportHeight.value + OVERFLOW_TOLERANCE_PX,
)

/** 滚不滚的单一真源：模板的双副本、动画类、静态回退都只看它。 */
const isRolling = computed(
  () =>
    props.autoScroll &&
    isOverflowing.value &&
    props.itemCount > 0 &&
    !isMotionReduced.value,
)

const durationS = computed(() =>
  Math.max(MIN_DURATION_S, props.itemCount * props.secondsPerItem),
)

const trackStyle = computed<CSSProperties | undefined>(() =>
  isRolling.value
    ? {
        '--dt-scroll-distance': `-${contentHeight.value}px`,
        animationDuration: `${durationS.value}s`,
      }
    : undefined,
)

onMounted(() => {
  measure()
  motionQuery = window.matchMedia(REDUCED_MOTION_QUERY)
  isMotionReduced.value = motionQuery.matches
  motionQuery.addEventListener('change', onMotionChange)
  observer = new ResizeObserver(measure)
  if (viewportRef.value !== null) observer.observe(viewportRef.value)
  if (copyRef.value !== null) observer.observe(copyRef.value)
})

// 条目数变了要等下一帧再量：这一帧 DOM 还没落地，量到的是上一批的高度。
// 帧句柄留着，连着变只保留最后一帧，卸载时取消。
watch(
  () => props.itemCount,
  () => {
    if (measureFrame !== 0) cancelAnimationFrame(measureFrame)
    measureFrame = requestAnimationFrame(() => {
      measureFrame = 0
      measure()
    })
  },
)

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  motionQuery?.removeEventListener('change', onMotionChange)
  motionQuery = null
  if (measureFrame !== 0) cancelAnimationFrame(measureFrame)
  measureFrame = 0
})
</script>

<template>
  <div
    ref="viewportRef"
    class="dt-scrolllist"
    :class="{ 'dt-scrolllist--static': !isRolling }"
  >
    <div
      class="dt-scrolllist__track"
      :class="{ 'dt-scrolllist__track--anim': isRolling }"
      :style="trackStyle"
    >
      <div ref="copyRef" class="dt-scrolllist__copy"><slot /></div>
      <!-- 无缝衔接用的第二份副本，只在真滚起来时才需要 -->
      <div v-if="isRolling" class="dt-scrolllist__copy" aria-hidden="true">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.dt-scrolllist {
  position: relative;
  overflow: hidden;
  height: 100%;
  min-height: 0;
}

// 不滚的时候把滚动权交回给用户
.dt-scrolllist--static {
  overflow-y: auto;
}

.dt-scrolllist__track {
  display: flex;
  flex-direction: column;
}

.dt-scrolllist__track--anim {
  animation-name: dt-scroll-marquee;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
  will-change: transform;
}

.dt-scrolllist:hover .dt-scrolllist__track--anim {
  animation-play-state: paused;
}

.dt-scrolllist__copy {
  flex: none;
}

@keyframes dt-scroll-marquee {
  from {
    transform: translateY(0);
  }

  to {
    transform: translateY(var(--dt-scroll-distance, 0));
  }
}
</style>
