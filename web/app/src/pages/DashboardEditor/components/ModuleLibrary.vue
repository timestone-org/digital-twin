<script setup lang="ts">
/**
 * @fileoverview 模块库：按清单的 `category` 分组列出全部已注册模块，
 * 支持点击添加与拖到画布落位。
 * ⚠ 这里没有任何模块类型字面量——库的内容完全来自注册表，
 * 第三方在启动期注册的清单会自动出现在这里（DASHBOARD_DESIGN §5.3 陷阱 ①③）。
 */
import type { ModuleManifest } from '@dt/contracts'
import { DtEmpty, DtIcon, DtInput } from '@dt/ui'
import { computed, ref } from 'vue'

import {
  MODULE_DRAG_MIME,
  groupModules,
} from '@/features/dashboard/moduleLibrary'

const props = defineProps<{ manifests: readonly ModuleManifest[] }>()
const emit = defineEmits<{ add: [manifest: ModuleManifest] }>()

const keyword = ref('')

/** 被取代的模块不再进库：注册照常、存量大屏照常渲染，只挡新增。 */
const groups = computed(() =>
  groupModules(
    props.manifests.filter((manifest) => manifest.replacedBy === undefined),
    keyword.value,
  ),
)

function onDragStart(event: DragEvent, manifest: ModuleManifest): void {
  if (event.dataTransfer === null) return
  event.dataTransfer.setData(MODULE_DRAG_MIME, manifest.type)
  event.dataTransfer.effectAllowed = 'copy'
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3">
    <DtInput v-model="keyword" size="sm" placeholder="搜索模块">
      <template #leading><DtIcon name="search" :size="14" /></template>
    </DtInput>
    <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      <DtEmpty
        v-if="groups.length === 0"
        icon="layout-grid"
        title="没有匹配的模块"
        hint="换个关键字，或检查模块是否已注册"
      />
      <section v-for="group in groups" :key="group.category">
        <h3 class="m-0 mb-2 text-2xs tracking-wide text-text-disabled">
          {{ group.category }}
        </h3>
        <button
          v-for="manifest in group.items"
          :key="manifest.type"
          type="button"
          class="dt-lib__item"
          draggable="true"
          :data-test="`module-${manifest.type}`"
          @click="emit('add', manifest)"
          @dragstart="onDragStart($event, manifest)"
        >
          <DtIcon :name="manifest.icon ?? 'layout-grid'" :size="16" />
          <span class="truncate">{{ manifest.displayName }}</span>
        </button>
      </section>
    </div>
  </div>
</template>

<style scoped lang="scss">
.dt-lib__item {
  display: flex;
  gap: 8px;
  align-items: center;
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-panel);
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;

  & + & {
    margin-top: 6px;
  }

  &:hover {
    border-color: var(--accent-primary);
  }
}
</style>
