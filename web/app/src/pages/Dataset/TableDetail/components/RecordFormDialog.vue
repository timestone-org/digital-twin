<script setup lang="ts">
/**
 * @fileoverview 录入 / 编辑一行数据的弹窗。公式列只读展示，保存后由后端算。
 *
 * ⚠ 点位汇总列填进去的值会被记成**人工修正**（盖住采集原值）而不是改采集值，
 * 所以只提交用户真的动过的那几格——理由与做法见 `scripts/recordForm.ts`。
 * ⚠ 编辑时 URL 上的 `?ts=` 必须是**改之前**那个时刻：它是超表的分区键，
 * 而 `values.ts` 才是要改成的新时刻。两者写反会去另一个 chunk 里找这一行。
 */
import { computed, ref, watch } from 'vue'
import type { DatasetColumn, DatasetRecord } from '@dt/contracts'
import {
  DtButton,
  DtDateTimeInput,
  DtInput,
  DtModal,
  DtNotice,
  DtSwitch,
} from '@dt/ui'

import * as dataset from '@/api/dataset'
import { describeError } from '@/composables/useAsyncList'
import { useFormDirty } from '@/composables/useFormDirty'
import { formatCell } from '../scripts/recordView'
import {
  formulaColumns,
  recordFormOf,
  toRecordInput,
  writableColumns,
  writeHint,
  type RecordFormState,
} from '../scripts/recordForm'

const props = defineProps<{
  modelValue: boolean
  tableId: string
  columns: readonly DatasetColumn[]
  /** 正在改的那一行；`null` 即录入新行。 */
  record: DatasetRecord | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [message: string, hasStale: boolean]
}>()

const form = ref<RecordFormState>(recordFormOf(null, []))
// 打开那一刻的取值：认「哪几格被动过」的基准，见 scripts/recordForm.ts
const opened = ref<RecordFormState>(recordFormOf(null, []))
const busy = ref(false)
const error = ref<string | null>(null)
const tsError = ref('')

const { isDirty } = useFormDirty(
  () => form.value,
  () => props.modelValue,
)

const isEdit = computed(() => props.record !== null)
const editable = computed(() => writableColumns(props.columns))
const derived = computed(() => formulaColumns(props.columns))
const hasPointColumn = computed(() =>
  editable.value.some((column) => column.source === 'point'),
)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    reset()
  },
  // ⚠ immediate：组件挂载时就已经是打开态的那种，只监听变化的 watch 一次都不跑
  { immediate: true },
)

// 开着的时候被换成另一行（表格里点了别的行的编辑）同样要重播种
watch(
  () => props.record,
  () => {
    if (props.modelValue) reset()
  },
)

function reset(): void {
  form.value = recordFormOf(props.record, props.columns)
  opened.value = recordFormOf(props.record, props.columns)
  error.value = null
  tsError.value = ''
}

async function save(): Promise<void> {
  const input = toRecordInput(form.value, opened.value, props.columns)
  const target = props.record
  if (target === null) {
    const created = await dataset.createDatasetRecord(props.tableId, input)
    emit('saved', '数据行已录入', created.has_stale_downstream)
    return
  }
  const saved = await dataset.updateDatasetRecord(
    { tableId: props.tableId, rowId: target.row_id, ts: target.ts },
    input,
  )
  emit('saved', '数据行已更新', saved.has_stale_downstream)
}

async function onSubmit(): Promise<void> {
  if (form.value.ts === '') {
    tsError.value = '请选一个数据时间'
    return
  }
  busy.value = true
  error.value = null
  try {
    await save()
    emit('update:modelValue', false)
  } catch (caught) {
    // ⚠ 取值的类型转换与必填校验一概由后端裁定，这里只如实转述它那一句：
    // 两处各写一份规则，迟早漂成两种口径
    error.value = describeError(caught)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <DtModal
    :model-value="props.modelValue"
    :dirty="isDirty"
    :title="isEdit ? '编辑数据行' : '录入数据'"
    description="一行 = 一个数据周期。公式列在保存时自动算出"
    width="40rem"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
      <DtDateTimeInput
        v-model="form.ts"
        label="数据时间"
        required
        :error="tsError"
        hint="补录历史行会让它之后那些行的跨行公式结果过期，保存后按提示重算"
      />

      <DtNotice v-if="hasPointColumn" intent="warning" icon="alert-triangle">
        点位汇总列填了会记为「人工修正」：采集原值完整保留，那一格会打上修正角标，随时可撤销。没动过的格子不会提交，所以打开看看再关掉不会留下任何痕迹。
      </DtNotice>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <template v-for="column in editable" :key="column.id">
          <DtSwitch
            v-if="column.data_type === 'bool'"
            class="self-end"
            :model-value="form.flags[column.key] ?? false"
            :label="column.name"
            @update:model-value="form.flags[column.key] = $event"
          />
          <DtInput
            v-else
            :model-value="form.texts[column.key] ?? ''"
            :label="column.name"
            :placeholder="column.unit ?? ''"
            :hint="writeHint(column, props.record)"
            @update:model-value="form.texts[column.key] = $event"
          />
        </template>
      </div>

      <!-- 公式列只读摆着：改原始值时能立刻看到会影响到哪几个派生指标 -->
      <div
        v-if="derived.length > 0"
        class="flex flex-col gap-1.5 rounded-md border border-border-subtle p-3 text-xs"
      >
        <span class="text-text-disabled">公式列（保存后自动计算）</span>
        <div
          v-for="column in derived"
          :key="column.id"
          class="flex items-center justify-between gap-2"
        >
          <span class="truncate text-text-secondary">{{ column.name }}</span>
          <span class="text-text-primary">
            {{
              props.record === null
                ? '保存后计算'
                : formatCell(props.record.computed[column.key], column)
            }}
          </span>
        </div>
      </div>

      <DtNotice v-if="error" intent="danger">{{ error }}</DtNotice>
    </form>

    <template #footer>
      <DtButton
        variant="ghost"
        intent="neutral"
        @click="emit('update:modelValue', false)"
      >
        取消
      </DtButton>
      <DtButton :loading="busy" @click="onSubmit">保存</DtButton>
    </template>
  </DtModal>
</template>
