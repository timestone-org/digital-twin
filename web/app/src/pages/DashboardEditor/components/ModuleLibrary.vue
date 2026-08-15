<script setup lang="ts">
/**
 * @fileoverview 模块库：按清单的 `category` 分组，把每个模块列成一张卡片，
 * 支持点击添加与拖到画布落位；卡片列数随侧栏宽度自适应。
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
        <h3 class="dt-lib__cat">
          <span class="truncate">{{ group.category }}</span>
          <span class="dt-lib__count">{{ group.items.length }}</span>
        </h3>
        <div class="dt-lib__grid">
          <button
            v-for="manifest in group.items"
            :key="manifest.type"
            type="button"
            class="dt-lib__item"
            draggable="true"
            :title="`${manifest.displayName} · 拖入或点击添加`"
            :data-test="`module-${manifest.type}`"
            @click="emit('add', manifest)"
            @dragstart="onDragStart($event, manifest)"
          >
            <DtIcon
              :name="manifest.icon ?? 'layout-grid'"
              :size="18"
              class="text-accent-primary"
            />
            <span class="dt-lib__name">{{ manifest.displayName }}</span>
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped lang="scss">
/** 卡片最窄多少，也就是列数换挡的刻度。 */
$card-min: 84px;

.dt-lib__cat {
  display: flex;
  gap: 6px;
  align-items: center;
  margin: 0 0 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
}

.dt-lib__count {
  flex: none;
  margin-left: auto;
  padding: 0 6px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-pill);
  background: var(--surface-sunken);
  font-size: 10px;
}

// 列数交给 auto-fill 自己算：侧栏是可拖的，钉死列数就只有一个宽度好看
.dt-lib__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax($card-min, 1fr));
  gap: 6px;
}

.dt-lib__item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
  padding: 12px 6px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  color: var(--text-primary);
  cursor: grab;
  transition:
    border-color 0.15s ease,
    transform 0.12s ease,
    box-shadow 0.15s ease;

  &:hover {
    border-color: color-mix(in srgb, var(--accent-primary) 50%, transparent);
    transform: translateY(-1px);
    box-shadow: 0 6px 18px -10px var(--accent-primary);
  }

  &:active {
    cursor: grabbing;
  }
}

.dt-lib__name {
  font-size: 11px;
  line-height: 1.2;
  text-align: center;
  overflow-wrap: anywhere;
}

@media (prefers-reduced-motion: reduce) {
  .dt-lib__item {
    transition: none;

    &:hover {
      transform: none;
    }
  }
}
</style>
