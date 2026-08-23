<script setup lang="ts">
/**
 * @fileoverview 工具箱里「其他台账的列」那一栏：选一张表，点它的列插入
 * `{表code.列key}`。
 *
 * ⚠ 可跨表引用的名单来自函数目录（`catalog.tables`），列则要再取一次那张表的
 * 列定义——目录只给 code 与名称。
 * ⚠ 这一栏取数失败**只丢跨表引用**，其余照常：编辑器不因此瘸腿，更不弹错
 * （docs/DATASET_DESIGN.md §7.13）。
 */
import { computed, onUnmounted, ref } from 'vue'
import type { DatasetColumn, DatasetFormulaTable } from '@dt/contracts'
import { DtSelect } from '@dt/ui'

import * as dataset from '@/api/dataset'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { externalRef, type InsertPayload } from '../scripts/formulaText'

const props = defineProps<{ tables: readonly DatasetFormulaTable[] }>()

const emit = defineEmits<{ insert: [payload: InsertPayload] }>()

/** 后端一次最多给这么多张台账；台账是业务级别的量，一页足够。 */
const TABLE_PAGE_SIZE = 200

const picked = ref('')
const columns = ref<DatasetColumn[]>([])
const loading = ref(false)
/** 取不到列时的一句实话，不是错误弹窗。 */
const failure = ref('')
const raced = useRacedFetch()

const options = computed(() =>
  props.tables.map((one) => ({ value: one.code, label: one.name })),
)

/**
 * code → id。目录只给 code，取列定义要 id。
 * @param code 台账编码
 */
async function idOf(code: string): Promise<string | null> {
  const page = await dataset.listDatasetTables({ size: TABLE_PAGE_SIZE })
  return page.items.find((one) => one.code === code)?.id ?? null
}

function onPick(code: string): void {
  picked.value = code
  columns.value = []
  failure.value = ''
  if (code === '') {
    raced.cancel()
    return
  }
  loading.value = true
  void raced.run(
    async () => {
      const id = await idOf(code)
      return id === null ? null : await dataset.listDatasetColumns(id)
    },
    {
      ok: (result) => {
        columns.value = result ?? []
        failure.value = result === null ? '这张台账已经不在了，换一张' : ''
      },
      fail: () => (failure.value = '取不到这张表的列，跨表引用只能手写'),
      settled: () => (loading.value = false),
    },
  )
}

// 弹窗关掉时作废在飞的那一次：它回来照样写状态，而那份状态已经没人看了
onUnmounted(() => raced.cancel())

function insert(column: DatasetColumn): void {
  const snippet = externalRef(picked.value, column.key)
  emit('insert', { snippet, caret: snippet.length })
}
</script>

<template>
  <section v-if="props.tables.length > 0" class="flex flex-col gap-1">
    <span class="text-2xs text-text-disabled">
      其他台账的列（按本行的时刻取对方最近的一条）
    </span>
    <div class="max-w-xs">
      <DtSelect
        :model-value="picked"
        :options="options"
        size="sm"
        aria-label="选一张其他台账"
        :display="{ placeholder: '选一张表' }"
        @update:model-value="onPick"
      />
    </div>
    <p v-if="loading" class="text-2xs text-text-disabled">载入中…</p>
    <p v-else-if="failure" class="text-2xs text-state-warning">{{ failure }}</p>
    <div v-else-if="columns.length > 0" class="flex flex-wrap gap-1.5">
      <button
        v-for="column in columns"
        :key="column.id"
        type="button"
        class="ftb-chip ftb-chip--ext"
        :title="`插入 {${picked}.${column.key}}`"
        @click="insert(column)"
      >
        {{ column.name }}
      </button>
    </div>
    <p v-else-if="picked !== ''" class="text-2xs text-text-disabled">
      这张台账还没有列
    </p>
  </section>
</template>

<style scoped>
.ftb-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 2px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 4px 6px;
  color: var(--text-secondary);
  font-size: 11px;
  transition:
    border-color 0.15s ease,
    color 0.15s ease;
}

/* 跨表引用换个色：它读的不是本表的数，混着看会误判口径 */
.ftb-chip--ext {
  border-color: rgba(var(--state-warning-rgb), 0.35);
  background: rgba(var(--state-warning-rgb), 0.05);
  color: var(--state-warning);
}

.ftb-chip:hover,
.ftb-chip:focus-visible {
  border-color: var(--border-hover);
}
</style>
