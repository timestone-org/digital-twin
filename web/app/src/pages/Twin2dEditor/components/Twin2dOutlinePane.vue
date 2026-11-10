<script setup lang="ts">
/**
 * @fileoverview 左栏：计数与样式库入口钉在顶上，大纲与调色板各自滚动。
 *
 * ⚠ 两段共用一个滚动容器的话，节点一多调色板就被挤到最下面，点调色板时计数行与
 * 样式库入口也一起滚出视野。
 */
import type { Twin2dConfig } from '@dt/twin2d'
import { DtButton } from '@dt/ui'
import { computed } from 'vue'

import type { Twin2dEditorSelection } from '../scripts/editorSelection'
import NodePalette from './NodePalette.vue'
import Twin2dOutline from './Twin2dOutline.vue'

const props = defineProps<{
  /** 整份 2D 孪生配置；本层只读，改动一律整份上抛。 */
  config: Twin2dConfig
  /** 画布与大纲共用的那一份选中态。 */
  selection: Twin2dEditorSelection
}>()

const emit = defineEmits<{
  /** 大纲算出来的整份新配置。 */
  change: [next: Twin2dConfig]
  /** 调色板上点了一份样式。 */
  add: [styleId: string]
  /** 打开样式库。 */
  openLibrary: []
}>()

const summary = computed(() => {
  const { nodes, edges, marks, styles } = props.config
  return `节点 ${nodes.length} · 连线 ${edges.length} · 标注 ${marks.length} · 样式 ${styles.length}`
})
</script>

<template>
  <aside
    class="flex min-h-0 flex-1 flex-col gap-2 p-2 text-2xs text-text-secondary"
    aria-label="大纲"
    data-test="outline"
  >
    <div class="flex shrink-0 items-center gap-1">
      <span class="min-w-0 flex-1 truncate">{{ summary }}</span>
      <DtButton
        size="xs"
        variant="ghost"
        intent="primary"
        icon="palette"
        aria-label="样式库"
        title="样式库：新建、复制、恢复内置与整包导入导出"
        data-test="open-style-library"
        @click="emit('openLibrary')"
      />
    </div>
    <div
      class="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      data-test="outline-scroll"
    >
      <Twin2dOutline
        :config="config"
        :selection="selection"
        @change="emit('change', $event)"
      />
    </div>
    <div
      class="max-h-[min(45dvh,420px)] shrink-0 overflow-y-auto overscroll-contain border-t border-border-subtle pt-2"
      data-test="palette-scroll"
    >
      <NodePalette :styles="config.styles" @add="emit('add', $event)" />
    </div>
  </aside>
</template>
