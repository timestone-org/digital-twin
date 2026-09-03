<script setup lang="ts">
/**
 * @fileoverview 左侧车间栏：选车间，以及车间自身的建改删。
 * ⚠ 每一项的两个计数直接来自后端，不在前端按已加载的房间去数——右栏只取了
 * 一页，按它数出来的会比实际少，而少几台是看不出来的。
 */
import type { Workshop } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtCard, DtEmpty, DtTag } from '@dt/ui'

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
  <DtCard
    icon="building"
    title="车间"
    padding="sm"
    class="workshop-rail flex min-h-0 flex-col"
  >
    <template #actions>
      <DtTag v-if="props.workshops.length !== 0" size="sm">
        {{ props.workshops.length }}
      </DtTag>
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
    </template>

    <ul v-if="props.workshops.length > 0" class="workshop-rail__list">
      <li v-for="workshop in props.workshops" :key="workshop.id">
        <div
          class="workshop-rail__row"
          :class="{ 'is-active': workshop.id === props.activeId }"
        >
          <span
            v-if="workshop.id === props.activeId"
            class="workshop-rail__mark"
            aria-hidden="true"
          />
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
  </DtCard>
</template>

<style scoped lang="scss">
.workshop-rail {
  // 随页宽伸缩而不是钉死一个数：钉死的话宽屏上它是一条越来越细的边条，
  // 窄屏上又占掉近三成。上下限对齐达标预测页（18rem）与采集页（20rem）
  width: clamp(16rem, 20vw, 20rem);
  flex: none;

  &__list {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
    overflow-y: auto;
  }

  // 与达标预测页的房间栏同一副长相：描边小卡 + 选中时左侧一道竖条
  &__row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 2px;
    overflow: hidden;
    padding-right: 2px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--surface-sunken) 40%, transparent);
    transition: var(--fx-transition);

    &:hover {
      border-color: var(--border-default);
      background: rgba(var(--accent-primary-rgb), 0.05);
    }

    &.is-active {
      border-color: rgba(var(--accent-primary-rgb), 0.5);
      background: rgba(var(--accent-primary-rgb), 0.1);
    }
  }

  &__mark {
    position: absolute;
    top: 50%;
    left: 0;
    width: 2px;
    height: 20px;
    border-radius: 0 2px 2px 0;
    background: var(--accent-primary);
    transform: translateY(-50%);
  }

  &__pick {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
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
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__meta {
    color: var(--text-secondary);
    font-size: 11px;
  }

  &__actions {
    display: flex;
    flex: none;
    align-items: center;
  }
}

.workshop-rail__row.is-active .workshop-rail__name {
  color: var(--text-title);
  font-weight: 500;
}
</style>
