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
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
// 两处取数各报各的：列没取到时台账下拉是满的，说成「清单没取到」会指错地方
const tablesFailure = ref('')
const columnsFailure = ref('')

const columnsFetch = useRacedFetch()

const tableOptions = computed<DtSelectOption[]>(() =>
  tables.value.map((table) => ({
    value: table.code,
    label: `${table.name}（${table.code}）`,
  })),
)

// ⚠ 只选表的草稿还不是完整列身份，必须保留表选择才能继续加载列。
const tableCode = computed(
  () =>
    parsed.value?.code ??
    tables.value.find(
      (table) => datasetBindingKey(table.code, '') === props.datasetKey,
    )?.code ??
    '',
)

const columnOptions = computed<DtSelectOption[]>(() =>
  columns.value.map((column) => ({
    value: column.key,
    label: column.unit ? `${column.name}（${column.unit}）` : column.name,
  })),
)

const tableId = computed(
  () => tables.value.find((item) => item.code === tableCode.value)?.id ?? '',
)

async function loadTables(): Promise<void> {
  try {
    const page = await dataset.listDatasetTables({ size: TABLE_PAGE_SIZE })
    tables.value = page.items
  } catch (caught) {
    tablesFailure.value = describeError(caught)
  }
}

/** 换台账就重取它的列；台账没选或找不到时列清单为空。 */
function loadColumns(id: string): void {
  columnsFetch.cancel()
  columns.value = []
  columnsFailure.value = ''
  if (id === '') return
  void columnsFetch.run(() => dataset.listDatasetColumns(id), {
    ok: (list) => {
      columns.value = list
    },
    fail: (caught: unknown) => {
      columnsFailure.value = describeError(caught)
    },
    settled: () => undefined,
  })
}

function pickTable(code: string): void {
  // 换表就把列清掉：留着上一张表的列标识，拼出来的是一条指向不存在的列的绑定
  emit('pick', datasetBindingKey(code, ''))
}

function pickColumn(key: string): void {
  const code = tableCode.value
  if (code === '') return
  emit('pick', datasetBindingKey(code, key))
}

watch(tableId, loadColumns, { immediate: true })
onBeforeUnmount(columnsFetch.cancel)
onMounted(() => {
  void loadTables()
})
</script>

<template>
  <DtField label="台账" size="sm">
    <DtSelect
      :model-value="tableCode"
      :options="tableOptions"
      size="sm"
      aria-label="台账"
      :display="{ placeholder: '选一张台账' }"
      @update:model-value="pickTable"
    />
  </DtField>
  <DtField label="列" size="sm">
    <DtSelect
      :model-value="parsed?.columnKey ?? ''"
      :options="columnOptions"
      size="sm"
      aria-label="列"
      :disabled="tableId === ''"
      :display="{ placeholder: '选一列' }"
      @update:model-value="pickColumn"
    />
  </DtField>
  <DtNotice v-if="tablesFailure" intent="warning" icon="alert-triangle">
    台账清单没取到：{{ tablesFailure }}。已配好的绑定不受影响。
  </DtNotice>
  <DtNotice v-else-if="columnsFailure" intent="warning" icon="alert-triangle">
    这张台账的列没取到：{{ columnsFailure }}。已配好的绑定不受影响。
  </DtNotice>
</template>
