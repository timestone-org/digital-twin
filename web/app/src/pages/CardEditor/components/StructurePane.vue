<script setup lang="ts">
/**
 * @fileoverview 左栏：部件列表与格列表，这一页的结构真源。
 * ⚠ 部件表是**卡片级**的——所有格共用这一份，所以它排在格前面：先定长什么样，
 * 再说有几个。摆反了会让人以为部件是逐格配的。
 */
import { DtButton, DtIcon } from '@dt/ui'

import type { StructureRow } from '../scripts/structureRows'

defineProps<{
  parts: readonly StructureRow[]
  cells: readonly StructureRow[]
  /** 选中的是哪一项，形如 `part:0` / `cell:2`；空串 = 什么都没选。 */
  activeKey: string
  canRemovePart: boolean
  canRemoveCell: boolean
}>()

const emit = defineEmits<{
  select: [key: string]
  addPart: []
  addCell: []
  removePart: [index: number]
  removeCell: [index: number]
  movePart: [index: number, delta: number]
}>()
</script>

<template>
  <div class="ce-tree flex h-full min-h-0 flex-col gap-3 overflow-y-auto pr-1">
    <section class="flex flex-col gap-1">
      <h3 class="ce-tree__head">部件 · 所有格共用</h3>
      <div
        v-for="(row, index) in parts"
        :key="row.key"
        class="ce-tree__row"
        :class="{ 'ce-tree__row--on': row.key === activeKey }"
      >
        <button
          type="button"
          class="ce-tree__pick"
          :data-test="`pick-${row.key}`"
          @click="emit('select', row.key)"
        >
          <DtIcon :name="row.icon" :size="12" />
          <span class="truncate">{{ row.label }}</span>
        </button>
        <DtButton
          variant="ghost"
          size="xs"
          icon="undo"
          aria-label="上移"
          :disabled="index === 0"
          @click="emit('movePart', index, -1)"
        />
        <DtButton
          variant="ghost"
          size="xs"
          icon="redo"
          aria-label="下移"
          :disabled="index === parts.length - 1"
          @click="emit('movePart', index, 1)"
        />
        <DtButton
          variant="ghost"
          intent="danger"
          size="xs"
          icon="trash"
          aria-label="删除部件"
          :disabled="!canRemovePart"
          @click="emit('removePart', index)"
        />
      </div>
      <DtButton size="sm" icon="plus" block @click="emit('addPart')">
        加部件
      </DtButton>
    </section>

    <section class="flex flex-col gap-1">
      <h3 class="ce-tree__head">格 · 每格一行数据</h3>
      <div
        v-for="(row, index) in cells"
        :key="row.key"
        class="ce-tree__row"
        :class="{ 'ce-tree__row--on': row.key === activeKey }"
      >
        <button
          type="button"
          class="ce-tree__pick"
          :data-test="`pick-${row.key}`"
          @click="emit('select', row.key)"
        >
          <DtIcon :name="row.icon" :size="12" />
          <span class="truncate">{{ row.label }}</span>
          <i v-if="row.note !== ''" class="ce-tree__note">{{ row.note }}</i>
        </button>
        <DtButton
          variant="ghost"
          intent="danger"
          size="xs"
          icon="trash"
          aria-label="删除格"
          :disabled="!canRemoveCell"
          @click="emit('removeCell', index)"
        />
      </div>
      <DtButton size="sm" icon="plus" block @click="emit('addCell')">
        加格
      </DtButton>
    </section>
  </div>
</template>

<style scoped>
.ce-tree__head {
  margin: 0 0 2px;
  color: var(--text-disabled);
  font-size: 11px;
  letter-spacing: 0.06em;
}

.ce-tree__row {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 4px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
}

.ce-tree__row:hover {
  background: var(--surface-raised);
}

.ce-tree__row--on {
  border-color: var(--accent-primary);
  background: var(--surface-raised);
}

.ce-tree__pick {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
  text-align: left;
}

.ce-tree__note {
  flex: none;
  color: var(--text-secondary);
  font-size: 11px;
  font-style: normal;
}
</style>
