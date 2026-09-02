<script setup lang="ts">
/**
 * @fileoverview 算子面板：按大类分组列出可用算子，拖到画布上摆，或点一下落在
 * 视野正中。
 *
 * 目录**整份来自后端**（`GET /modeling-operators`）：新增一个算子不用改前端，
 * 这是「可扩展」那条要求落到界面上的样子（MODELING_DESIGN §9.3）。
 * ⚠ 拖拽走自定义 MIME：认 `text/plain` 的话，从别处拖进来的任意文本都会被当成
 * 一次添加。
 */
import type { ModelingCategory, ModelingOperator } from '@dt/contracts'
import { DtEmpty, DtIcon, DtInput } from '@dt/ui'
import { computed, ref } from 'vue'

import { OPERATOR_MIME } from '../scripts/dragMime'

const props = defineProps<{
  operators: readonly ModelingOperator[]
  isReadonly: boolean
}>()

const emit = defineEmits<{ pick: [code: string] }>()

/** 大类的显示顺序与中文名。**认不出的大类排在最后**，不丢掉。 */
const CATEGORY_LABELS: Record<string, string> = {
  source: '取数',
  preprocess: '预处理',
  feature: '特征',
  model: '模型',
  evaluate: '评估',
}
const CATEGORY_ORDER: readonly ModelingCategory[] = [
  'source',
  'preprocess',
  'feature',
  'model',
  'evaluate',
]

const keyword = ref('')

const matched = computed(() => {
  const needle = keyword.value.trim().toLowerCase()
  if (needle === '') return props.operators
  return props.operators.filter(
    (item) =>
      item.name.toLowerCase().includes(needle) ||
      item.code.toLowerCase().includes(needle) ||
      item.description.toLowerCase().includes(needle),
  )
})

const groups = computed(() => {
  const byCategory = new Map<string, ModelingOperator[]>()
  for (const item of matched.value) {
    const bucket = byCategory.get(item.category) ?? []
    bucket.push(item)
    byCategory.set(item.category, bucket)
  }
  return [...byCategory.entries()]
    .sort((left, right) => rank(left[0]) - rank(right[0]))
    .map(([category, items]) => ({
      category,
      label: CATEGORY_LABELS[category] ?? category,
      items,
    }))
})

function rank(category: string): number {
  const at = CATEGORY_ORDER.indexOf(category as ModelingCategory)
  return at < 0 ? CATEGORY_ORDER.length : at
}

/** 开始把一个算子拖向画布。只读时不给拖。 */
function onDragStart(event: DragEvent, code: string): void {
  if (props.isReadonly || event.dataTransfer === null)
    return event.preventDefault()
  event.dataTransfer.setData(OPERATOR_MIME, code)
  event.dataTransfer.effectAllowed = 'copy'
}
</script>

<template>
  <aside class="dt-ml-palette">
    <DtInput
      v-model="keyword"
      type="search"
      size="sm"
      placeholder="搜算子"
      aria-label="搜算子"
    />
    <div class="dt-ml-palette__body">
      <DtEmpty
        v-if="groups.length === 0"
        inline
        title="没有匹配的算子"
        hint="换个词试试，或清空搜索看全部。"
      />
      <section v-for="group in groups" :key="group.category">
        <h3 class="dt-ml-palette__title">{{ group.label }}</h3>
        <button
          v-for="item in group.items"
          :key="item.code"
          type="button"
          class="dt-ml-palette__item"
          :draggable="!props.isReadonly"
          :disabled="props.isReadonly"
          :title="item.description"
          @dragstart="onDragStart($event, item.code)"
          @click="emit('pick', item.code)"
        >
          <DtIcon :name="item.icon" :size="14" />
          <span class="dt-ml-palette__name">{{ item.name }}</span>
        </button>
      </section>
    </div>
    <p class="dt-ml-palette__hint">拖到画布上摆放，或点一下落在视野正中</p>
  </aside>
</template>

<style scoped lang="scss">
.dt-ml-palette {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 13rem;
  padding: 0.75rem;
  border-right: 1px solid var(--border-subtle);
  background: var(--surface-panel);

  &__body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.75rem;
    min-height: 0;
    overflow-y: auto;
  }

  &__title {
    margin: 0 0 0.25rem;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }

  &__item {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    width: 100%;
    padding: 0.375rem 0.5rem;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-primary);
    font-size: var(--ctl-fs-sm);
    text-align: left;
    cursor: pointer;

    &:hover:not(:disabled) {
      border-color: var(--border-hover);
      background: var(--surface-raised);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }

  &__name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__hint {
    margin: 0;
    color: var(--text-disabled);
    font-size: var(--ctl-hint-fs-sm);
    line-height: 1.4;
  }
}
</style>
