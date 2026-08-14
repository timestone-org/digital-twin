<script setup lang="ts">
/**
 * @fileoverview 模块库：按清单的 `category` 分组列出全部已注册模块。
 * ⚠ 这里没有任何模块类型字面量——库的内容完全来自注册表，
 * 第三方在启动期注册的清单会自动出现在这里（DASHBOARD_DESIGN §5.3 陷阱 ①③）。
 */
import type { ModuleManifest } from '@dt/contracts'
import { DtEmpty, DtIcon, DtInput } from '@dt/ui'
import { computed, ref } from 'vue'

import { groupModules } from '@/features/dashboard/moduleLibrary'

const props = defineProps<{ manifests: readonly ModuleManifest[] }>()
const emit = defineEmits<{ add: [manifest: ModuleManifest] }>()

const keyword = ref('')
const groups = computed(() => groupModules(props.manifests, keyword.value))
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
          @click="emit('add', manifest)"
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
