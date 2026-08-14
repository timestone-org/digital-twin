<script setup lang="ts">
/**
 * @fileoverview 大屏缩略图，进视口才去取图；取不到时画一张按 id 确定性生成的占位。
 *
 * ⚠ 一个项目下几十张卡片同时挂载，不懒加载就是几十个并发请求外加几十份
 * data URL 常驻内存。observer 在卸载与命中之后都要 disconnect。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { DtIcon } from '@dt/ui'

import { getDashboardThumbnail } from '@/api/dashboardThumbnail'
import { placeholderBlocks } from '../thumbnailPlaceholder'

const props = defineProps<{ dashboardId: string }>()

/** 提前一屏开始取图，滚动到位时图已经在了。 */
const PRELOAD_MARGIN = '160px'

const rootEl = ref<HTMLElement | null>(null)
const imageUrl = ref<string | null>(null)
const isLoading = ref(true)
let observer: IntersectionObserver | null = null
let hasStarted = false
let isAlive = true

const blocks = computed(() => placeholderBlocks(props.dashboardId))

async function load(): Promise<void> {
  if (hasStarted) return
  hasStarted = true
  try {
    const thumbnail = await getDashboardThumbnail(props.dashboardId)
    // ⚠ await 之后组件可能已经卸载：再写响应式状态会在死实例上触发更新
    if (isAlive) imageUrl.value = thumbnail?.data ?? null
  } catch {
    // 取不到图不是错误态，画占位就行——错误在这里弹一排 toast 才是灾难
    if (isAlive) imageUrl.value = null
  } finally {
    if (isAlive) isLoading.value = false
  }
}

function stopObserving(): void {
  observer?.disconnect()
  observer = null
}

onMounted(() => {
  if (typeof IntersectionObserver === 'undefined') {
    void load()
    return
  }
  observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      stopObserving()
      void load()
    },
    { rootMargin: PRELOAD_MARGIN },
  )
  if (rootEl.value !== null) observer.observe(rootEl.value)
})

onBeforeUnmount(() => {
  isAlive = false
  stopObserving()
})
</script>

<template>
  <div
    ref="rootEl"
    class="relative aspect-video w-full overflow-hidden rounded-sm border border-border-subtle bg-surface-sunken"
  >
    <div
      v-if="isLoading"
      class="dt-animate-fade-up absolute inset-0 bg-surface-raised"
      aria-hidden="true"
    />

    <img
      v-else-if="imageUrl !== null"
      :src="imageUrl"
      alt=""
      class="h-full w-full object-cover"
      draggable="false"
    />

    <div
      v-else
      class="dt-grid-bg absolute inset-0"
      data-test="thumb-placeholder"
    >
      <span
        v-for="block in blocks"
        :key="block.key"
        class="absolute rounded-sm border border-accent-primary/25 bg-accent-primary/10"
        :style="{
          left: `${block.leftPercent}%`,
          top: `${block.topPercent}%`,
          width: `${block.widthPercent}%`,
          height: `${block.heightPercent}%`,
        }"
      />
      <span
        class="absolute inset-0 flex items-center justify-center text-accent-primary/30"
      >
        <DtIcon name="layout-grid" :size="28" />
      </span>
    </div>
  </div>
</template>
