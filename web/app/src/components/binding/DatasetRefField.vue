<script setup lang="ts">
/**
 * @fileoverview 挑一个台账列：先选台账、再选它的列，拼出 `ds:{code}:{列key}`。
 *
 * ⚠ 身份串一律由 `datasetBindingKey` 拼、由 `parseDatasetBindingKey` 拆，
 * 这里一个字面量都不写：两端各拼一份时，写歪一个字符不会有任何报错，只是
 * 这条绑定永远取不到数——而那与「台账里这一格确实是空」长得一模一样。
 * ⚠ 台账列表与列清单取不到时，把已存的身份串**原样显示**而不是清空：清空
 * 等于因为一次取数失败就把用户配好的绑定改掉。
 */
import { computed, onMounted, ref, watch } from 'vue'
import type {
  DatasetColumn,
  DatasetTableSummary,
  DtSelectOption,
} from '@dt/contracts'
import { datasetBindingKey, parseDatasetBindingKey } from '@dt/contracts'
import { DtField, DtNotice, DtSelect } from '@dt/ui'

import * as dataset from '@/api/dataset'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'

/** 一次拉够：台账是业务级别的数量，几十张顶天，不值得为它做翻页。 */
const TABLE_PAGE_SIZE = 200

const props = defineProps<{
  /** 当前已配的身份串；没配过给空串。 */
  datasetKey: string
}>()

const emit = defineEmits<{ pick: [key: string] }>()

const parsed = computed(() => parseDatasetBindingKey(props.datasetKey))

const tables = ref<readonly DatasetTableSummary[]>([])
const columns = ref<readonly DatasetColumn[]>([])
const failure = ref('')

const columnsFetch = useRacedFetch()

const tableOptions = computed<DtSelectOption[]>(() =>
  tables.value.map((table) => ({
    value: table.code,
    label: `${table.name}（${table.code}）`,
  })),
)

const columnOptions = computed<DtSelectOption[]>(() =>
  columns.value.map((column) => ({
    value: column.key,
    label: column.unit ? `${column.name}（${column.unit}）` : column.name,
  })),
)

const tableId = computed(
  () => tables.value.find((item) => item.code === parsed.value?.code)?.id ?? '',
)

async function loadTables(): Promise<void> {
  try {
    const page = await dataset.listDatasetTables({ size: TABLE_PAGE_SIZE })
    tables.value = page.items
  } catch (caught) {
    failure.value = describeError(caught)
  }
}

/** 换台账就重取它的列；台账没选或找不到时列清单为空。 */
function loadColumns(id: string): void {
  if (id === '') {
    columns.value = []
    return
  }
  void columnsFetch.run(() => dataset.listDatasetColumns(id), {
    ok: (list) => {
      columns.value = list
    },
    fail: (caught: unknown) => {
      failure.value = describeError(caught)
    },
    settled: () => undefined,
  })
}

function pickTable(code: string): void {
  // 换表就把列清掉：留着上一张表的列标识，拼出来的是一条指向不存在的列的绑定
  emit('pick', datasetBindingKey(code, ''))
}

function pickColumn(key: string): void {
  const code = parsed.value?.code
  if (code === undefined) return
  emit('pick', datasetBindingKey(code, key))
}

watch(tableId, loadColumns, { immediate: true })
onMounted(() => {
  void loadTables()
})
</script>

<template>
  <DtField label="台账" size="sm">
    <DtSelect
      :model-value="parsed?.code ?? ''"
      :options="tableOptions"
      size="sm"
      placeholder="选一张台账"
      @update:model-value="pickTable"
    />
  </DtField>
  <DtField label="列" size="sm">
    <DtSelect
      :model-value="parsed?.columnKey ?? ''"
      :options="columnOptions"
      size="sm"
      placeholder="选一列"
      @update:model-value="pickColumn"
    />
  </DtField>
  <DtNotice v-if="failure" intent="warning" icon="alert-triangle">
    台账清单没取到：{{ failure }}。已配好的绑定不受影响。
  </DtNotice>
</template>
