<script setup lang="ts">
/**
 * @fileoverview 左侧车间栏：选车间，以及车间自身的建改删。
 * ⚠ 每一项的两个计数直接来自后端，不在前端按已加载的房间去数——右栏只取了
 * 一页，按它数出来的会比实际少，而少几台是看不出来的。
 */
import type { Workshop } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtEmpty } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'

const props = defineProps<{
  workshops: readonly Workshop[]
  activeId: string
}>()

const emit = defineEmits<{
  select: [workshopId: string]
  create: []
  rename: [workshop: Workshop]
  remove: [workshop: Workshop]
}>()
</script>

<template>
  <aside class="workshop-rail">
    <div class="workshop-rail__head">
      <span class="workshop-rail__title">车间</span>
      <PermGuard :codes="[PERMISSION_CODES.acManage]">
        <DtButton
          variant="ghost"
          intent="neutral"
          size="sm"
          icon="plus"
          aria-label="新建车间"
          title="新建车间"
          @click="emit('create')"
        />
      </PermGuard>
    </div>

    <ul v-if="props.workshops.length > 0" class="workshop-rail__list">
      <li v-for="workshop in props.workshops" :key="workshop.id">
        <div
          class="workshop-rail__row"
          :class="{ 'is-active': workshop.id === props.activeId }"
        >
          <button
            type="button"
            class="workshop-rail__pick"
            :aria-current="workshop.id === props.activeId"
            @click="emit('select', workshop.id)"
          >
            <span class="workshop-rail__name">{{ workshop.name }}</span>
            <span class="workshop-rail__meta">
              {{ workshop.room_count }} 房 · {{ workshop.ac_unit_count }} 台
            </span>
          </button>
          <PermGuard :codes="[PERMISSION_CODES.acManage]">
            <span class="workshop-rail__actions">
              <DtButton
                variant="ghost"
                intent="neutral"
                size="sm"
                icon="pencil"
                :aria-label="`重命名 ${workshop.name}`"
                title="重命名"
                @click="emit('rename', workshop)"
              />
              <DtButton
                variant="ghost"
                intent="danger"
                size="sm"
                icon="trash"
                :aria-label="`删除 ${workshop.name}`"
                title="删除"
                @click="emit('remove', workshop)"
              />
            </span>
          </PermGuard>
        </div>
      </li>
    </ul>

    <DtEmpty
      v-else
      class="flex-1"
      icon="building"
      title="还没有车间"
      hint="先建一个车间，再往里分房间。"
    />
  </aside>
</template>

<style scoped lang="scss">
.workshop-rail {
  display: flex;
  width: 15rem;
  flex: none;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--card-border);
  border-radius: var(--card-radius);
  background: var(--card-bg);
  overflow: auto;

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  &__title {
    color: var(--text-secondary);
    font-size: 12px;
    letter-spacing: 0.08em;
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  &__row {
    display: flex;
    align-items: center;
    gap: 2px;
    border-radius: var(--radius-md);
    padding-right: 2px;

    &:hover {
      background: var(--surface-raised);
    }

    &.is-active {
      background: rgba(var(--accent-primary-rgb), 0.14);
    }
  }

  &__pick {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    padding: 8px;
    border: none;
    background: transparent;
    color: var(--text-primary);
    text-align: left;
    cursor: pointer;

    &:focus-visible {
      outline: 2px solid var(--border-focus);
      outline-offset: -2px;
      border-radius: var(--radius-md);
    }
  }

  &__name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__meta {
    color: var(--text-secondary);
    font-size: 12px;
  }

  &__actions {
    display: flex;
    flex: none;
    align-items: center;
  }
}
</style>
