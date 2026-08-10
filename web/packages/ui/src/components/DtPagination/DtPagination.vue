<script setup lang="ts">
/**
 * @fileoverview DtPagination —— 条目区间 + 页码 + 每页条数，一条 nav 装完。
 * 页数、区间与省略号窗口的算术在同目录 `pages.ts`，边界用例钉在那一层。
 */
import { computed, watch } from 'vue'
import type { DtSelectOption } from '@dt/contracts'
import DtButton from '../DtButton/DtButton.vue'
import DtSelect from '../DtSelect/DtSelect.vue'
import {
  DT_PAGE_SIZE_OPTIONS,
  buildPageItems,
  clampPage,
  itemRange,
  pageCount,
} from './pages'

const props = withDefaults(
  defineProps<{
    /** 1 起的当前页。越界值会被收回范围内再渲染。 */
    page: number
    size: number
    total: number
    sizeOptions?: readonly number[] | undefined
    ariaLabel?: string | undefined
  }>(),
  { sizeOptions: () => DT_PAGE_SIZE_OPTIONS, ariaLabel: '分页' },
)

const emit = defineEmits<{
  'update:page': [value: number]
  'update:size': [value: number]
}>()

const count = computed(() => pageCount(props.total, props.size))
const current = computed(() => clampPage(props.page, count.value))

/**
 * 入参越界时把修正回吐给父组件。
 * ⚠ 只在渲染层夹住是不够的：删到最后一页只剩空页时，父组件仍持有旧页码去取数，
 * 表格是空的、分页器却高亮着被夹回来的那一页，而点那一页因为「与当前页相同」
 * 不会 emit——按钮成了死键，用户只能靠点上一页绕出去。
 */
watch(
  [current, () => props.page],
  ([clamped, given]) => {
    if (clamped !== given) emit('update:page', clamped)
  },
  { immediate: true },
)
const items = computed(() => buildPageItems(current.value, count.value))
const hasPrev = computed(() => current.value > 1)
const hasNext = computed(() => current.value < count.value)

const summary = computed(() => {
  if (props.total <= 0) return '共 0 条'
  const range = itemRange(current.value, props.size, props.total)
  return `第 ${range.from}–${range.to} 条，共 ${props.total} 条`
})

const sizeChoices = computed<DtSelectOption[]>(() => {
  // 当前档不在备选里就补进去，否则下拉显示的是 placeholder，看着像没设过每页条数
  const values = props.sizeOptions.includes(props.size)
    ? [...props.sizeOptions]
    : [...props.sizeOptions, props.size].sort((a, b) => a - b)
  return values.map((value) => ({
    value: String(value),
    label: `${value} 条/页`,
  }))
})

function go(page: number): void {
  if (page < 1 || page > count.value || page === current.value) return
  emit('update:page', page)
}

/**
 * 换每页条数。取值是 `sizeChoices` 里 `String(number)` 的原路返回，故直接转回数字。
 * ⚠ 必须同时把页码打回第 1 页：在第 9 页把 size 从 10 改成 100，不回第一页
 * 就直接落到一个空页，用户会以为数据没了。
 * @param value DtSelect 抛回的字符串取值
 */
function onSize(value: string): void {
  emit('update:page', 1)
  emit('update:size', Number(value))
}
</script>

<template>
  <nav class="dt-pagination" :aria-label="ariaLabel">
    <p class="dt-pagination__summary">{{ summary }}</p>

    <div class="dt-pagination__pages">
      <DtButton
        variant="ghost"
        intent="neutral"
        size="sm"
        :disabled="!hasPrev"
        @click="go(current - 1)"
      >
        上一页
      </DtButton>

      <template v-for="item in items" :key="item.key">
        <DtButton
          v-if="item.kind === 'page'"
          class="dt-pagination__page"
          size="sm"
          :variant="item.page === current ? 'soft' : 'ghost'"
          :intent="item.page === current ? 'primary' : 'neutral'"
          :aria-current="item.page === current ? 'page' : undefined"
          @click="go(item.page)"
        >
          {{ item.page }}
        </DtButton>
        <span v-else class="dt-pagination__gap" aria-hidden="true">…</span>
      </template>

      <DtButton
        variant="ghost"
        intent="neutral"
        size="sm"
        :disabled="!hasNext"
        @click="go(current + 1)"
      >
        下一页
      </DtButton>
    </div>

    <DtSelect
      class="dt-pagination__size"
      size="sm"
      :model-value="String(size)"
      :options="sizeChoices"
      aria-label="每页条数"
      @update:model-value="onSize"
    />
  </nav>
</template>

<style scoped lang="scss">
.dt-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;

  &__summary {
    margin: 0;
    font-size: 12px;
    color: var(--text-disabled);
  }

  &__pages {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    margin-left: auto;
  }

  // 单双位数页码要一样宽，否则翻页时整条页码会左右抖
  &__page {
    min-width: var(--ctl-h-sm);
    padding: 0 6px;
  }

  &__gap {
    padding: 0 2px;
    font-size: 12px;
    color: var(--text-disabled);
    user-select: none;
  }

  &__size {
    width: 7.5rem;
  }
}
</style>
