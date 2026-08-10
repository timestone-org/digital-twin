<script setup lang="ts">
/**
 * @fileoverview DtSelect 的浮层：搜索框 + 选项列表。只负责渲染与滚动，
 * 选中、键盘与定位都在 DtSelect 里。
 *
 * ⚠ teleport 到 body：`position: fixed` 的包含块会被祖先的 `transform` /
 * `filter` / `backdrop-filter` 劫持——本仓的顶栏与侧栏正好都开了 backdrop-blur，
 * 不 teleport 的话浮层会贴到那些元素上而不是视口。
 */
import { nextTick, ref, watch } from 'vue'
import type { DtSelectOption } from '@dt/contracts'
import DtIcon from '../DtIcon/DtIcon.vue'

const props = defineProps<{
  id: string
  options: readonly DtSelectOption[]
  selected: string
  activeIndex: number
  style: Record<string, string>
  searchable: boolean
  query: string
  searchPlaceholder: string | undefined
  emptyText: string | undefined
  labelledby: string | undefined
  /** teleport 目标。见 DtSelect 里挑目标的理由。 */
  to: string | HTMLElement
}>()

const emit = defineEmits<{
  pick: [option: DtSelectOption]
  hover: [index: number]
  'update:query': [value: string]
  keydown: [event: KeyboardEvent]
}>()

const el = ref<HTMLElement | null>(null)
const search = ref<HTMLInputElement | null>(null)

/** 键盘移动高亮时把它滚进可视区；`nearest` 保证不会整页跳。 */
function scrollActiveIntoView(): void {
  el.value
    ?.querySelector<HTMLElement>('[data-active="true"]')
    ?.scrollIntoView({ block: 'nearest' })
}

function focusSearch(): void {
  search.value?.focus()
}

watch(
  () => props.activeIndex,
  () => {
    void nextTick(scrollActiveIntoView)
  },
)

defineExpose({ el, focusSearch, scrollActiveIntoView })
</script>

<template>
  <Teleport :to="to">
    <div ref="el" class="dt-select-menu" :style="style">
      <div v-if="searchable" class="dt-select-menu__search">
        <DtIcon name="search" :size="13" />
        <input
          ref="search"
          class="dt-select-menu__input"
          type="text"
          autocomplete="off"
          :placeholder="searchPlaceholder"
          :value="query"
          :aria-controls="id"
          :aria-activedescendant="
            activeIndex >= 0 ? `${id}-o${activeIndex}` : undefined
          "
          @input="
            emit(
              'update:query',
              ($event.target as HTMLInputElement | null)?.value ?? '',
            )
          "
          @keydown="emit('keydown', $event)"
        />
      </div>

      <ul
        :id="id"
        class="dt-select-menu__list"
        role="listbox"
        :aria-labelledby="labelledby"
      >
        <li
          v-for="(option, index) in options"
          :id="`${id}-o${index}`"
          :key="option.value"
          class="dt-select-menu__item"
          :class="{
            'is-active': index === activeIndex,
            'is-selected': option.value === selected,
            'is-disabled': option.disabled === true,
          }"
          role="option"
          :data-active="index === activeIndex"
          :aria-selected="option.value === selected"
          :aria-disabled="option.disabled === true || undefined"
          @mouseenter="emit('hover', index)"
          @click="option.disabled === true ? undefined : emit('pick', option)"
        >
          <span class="dt-select-menu__label">{{ option.label }}</span>
          <DtIcon
            v-if="option.value === selected"
            name="check"
            :size="14"
            class="dt-select-menu__tick"
          />
        </li>
        <li v-if="options.length === 0" class="dt-select-menu__empty">
          {{ emptyText }}
        </li>
      </ul>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.dt-select-menu {
  display: flex;
  flex-direction: column;
  max-height: 18rem;
  overflow: hidden;
  background: var(--surface-overlay);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  box-shadow: 0 12px 32px rgb(0 0 0 / 45%);
  backdrop-filter: blur(6px);

  &__search {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border-subtle);
    color: var(--text-disabled);
  }

  &__input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    outline: none;
    color: var(--text-primary);
    font: inherit;
    font-size: 13px;

    &::placeholder {
      color: var(--text-disabled);
    }
  }

  &__list {
    overflow-y: auto;
    margin: 0;
    padding: 4px;
    list-style: none;
  }

  &__item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 10px;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: 13px;
    cursor: pointer;

    // 高亮跟着键盘与指针走：两者共用一个状态，免得出现两条高亮
    &.is-active {
      background: rgba(var(--accent-primary-rgb), 0.14);
      color: var(--text-primary);
    }

    &.is-selected {
      color: var(--accent-primary);
    }

    &.is-disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
  }

  &__label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__tick {
    flex-shrink: 0;
  }

  &__empty {
    padding: 16px 10px;
    text-align: center;
    color: var(--text-disabled);
    font-size: 12px;
  }
}
</style>
