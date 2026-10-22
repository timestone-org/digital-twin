<script setup lang="ts">
/** @fileoverview 地址空间树的有界渲染窗口。 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { DtButton } from '@dt/ui'

import type { NodeSelection, TreeNode } from '../scripts/browseTree'
import {
  BROWSE_INITIAL_HEIGHT,
  BROWSE_ROW_HEIGHT,
  browseWindow,
  visibleBrowseRows,
} from '../scripts/browseViewport'
import BrowseTreeNode from './BrowseTreeNode.vue'

const props = defineProps<{
  roots: TreeNode[]
  nextToken: string | null
  loadingMore: boolean
  states: ReadonlyMap<string, NodeSelection>
  taken: ReadonlySet<string>
}>()
const emit = defineEmits<{
  expand: [address: string]
  toggle: [address: string]
  loadMore: [address: string | null]
}>()

const viewport = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const height = ref(BROWSE_INITIAL_HEIGHT)
const rows = computed(() =>
  visibleBrowseRows(props.roots, props.nextToken, props.loadingMore),
)
const range = computed(() =>
  browseWindow(rows.value.length, scrollTop.value, height.value),
)
const visible = computed(() =>
  rows.value.slice(range.value.start, range.value.end),
)
const totalHeight = computed(() => `${rows.value.length * BROWSE_ROW_HEIGHT}px`)
const offset = computed(
  () => `translateY(${range.value.start * BROWSE_ROW_HEIGHT}px)`,
)
const rowStyle = { height: `${BROWSE_ROW_HEIGHT}px` }
let observer: ResizeObserver | null = null

function measure(): void {
  height.value = viewport.value?.clientHeight || BROWSE_INITIAL_HEIGHT
}

function onScroll(): void {
  scrollTop.value = viewport.value?.scrollTop ?? 0
}

function onKeydown(event: KeyboardEvent): void {
  if (event.target !== viewport.value) return
  const distances: Record<string, number> = {
    ArrowDown: BROWSE_ROW_HEIGHT,
    ArrowUp: -BROWSE_ROW_HEIGHT,
    PageDown: height.value,
    PageUp: -height.value,
    Home: -scrollTop.value,
    End: rows.value.length * BROWSE_ROW_HEIGHT,
  }
  const distance = distances[event.key]
  if (distance === undefined || viewport.value === null) return
  event.preventDefault()
  viewport.value.scrollTop = Math.max(
    0,
    Math.min(
      scrollTop.value + distance,
      rows.value.length * BROWSE_ROW_HEIGHT - height.value,
    ),
  )
  onScroll()
}

watch(
  () => rows.value.length,
  (length) => {
    const maximum = Math.max(0, length * BROWSE_ROW_HEIGHT - height.value)
    if (scrollTop.value <= maximum) return
    scrollTop.value = maximum
    if (viewport.value !== null) viewport.value.scrollTop = maximum
  },
)

onMounted(() => {
  measure()
  observer = new ResizeObserver(measure)
  if (viewport.value !== null) observer.observe(viewport.value)
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div
    ref="viewport"
    class="browse-viewport h-full min-h-0 overflow-auto"
    role="tree"
    aria-label="OPC UA 地址空间"
    tabindex="0"
    @scroll="onScroll"
    @keydown="onKeydown"
  >
    <div class="relative" :style="{ height: totalHeight }">
      <ul
        class="absolute inset-x-0 top-0 m-0 p-0"
        role="group"
        :style="{ transform: offset }"
      >
        <template v-for="row in visible" :key="row.key">
          <BrowseTreeNode
            v-if="row.kind === 'node'"
            :node="row.node"
            :depth="row.depth"
            :states="states"
            :taken="taken"
            :style="rowStyle"
            @expand="emit('expand', $event)"
            @toggle="emit('toggle', $event)"
          />
          <li
            v-else-if="row.kind === 'error'"
            class="browse-message text-state-danger"
            :style="rowStyle"
            role="none"
          >
            <p
              class="m-0 truncate text-xs"
              :title="row.node.error ?? undefined"
            >
              {{ row.node.error }}
            </p>
          </li>
          <li v-else class="browse-message" :style="rowStyle" role="none">
            <DtButton
              variant="ghost"
              size="xs"
              :loading="row.isLoading"
              :aria-label="`继续浏览「${row.name}」`"
              @click="emit('loadMore', row.address)"
            >
              加载更多点位
            </DtButton>
          </li>
        </template>
      </ul>
    </div>
  </div>
</template>

<style scoped lang="scss">
.browse-viewport {
  overflow-anchor: none;
}
.browse-message {
  display: flex;
  align-items: center;
  list-style: none;
  min-width: 0;
}
</style>
