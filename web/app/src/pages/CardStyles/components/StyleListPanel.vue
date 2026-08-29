<script setup lang="ts">
/**
 * @fileoverview 左栏：按「通用外壳 / 各卡片模块」分组的样式名单，内置与用户的并排。
 * 内置条目由行组件挂一枚锁形角标——它们能复制一份改，不能改也不能删。
 */
import { DtButton, DtEmpty } from '@dt/ui'

import type { LibraryEntry, StyleGroup } from '../scripts/libraryEntries'
import StyleListRow from './StyleListRow.vue'

defineProps<{
  groups: readonly StyleGroup[]
  activeKey: string | null
  loading: boolean
}>()

const emit = defineEmits<{
  select: [entry: LibraryEntry]
  remove: [entry: LibraryEntry]
  create: []
}>()
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2">
    <div class="min-h-0 flex-1 overflow-y-auto pr-1">
      <DtEmpty
        v-if="!loading && groups.length === 0"
        title="还没有样式"
        hint="点下面的「新建样式」存第一条"
      />
      <section v-for="group in groups" :key="group.title" class="mb-3">
        <h3 class="dt-style-group">{{ group.title }}</h3>
        <ul class="flex flex-col gap-1">
          <li v-for="entry in group.items" :key="entry.key">
            <StyleListRow
              :entry="entry"
              :active="entry.key === activeKey"
              @select="emit('select', entry)"
              @remove="emit('remove', entry)"
            />
          </li>
        </ul>
      </section>
    </div>
    <DtButton size="sm" icon="plus" block @click="emit('create')">
      新建样式
    </DtButton>
  </div>
</template>

<style scoped>
.dt-style-group {
  margin: 0 0 4px;
  padding: 0 4px;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.04em;
}
</style>
