<script setup lang="ts">
/**
 * @fileoverview 新增 / 编辑列的弹窗：公共几格 + 三选一的来源子块。
 *
 * ⚠ 列标识只在新增时可填：它是数据行 JSONB 里的字段名，也是公式里的
 * `{列标识}`，改一次等于让这一列的历史值集体失联，而每一行看起来都还在，
 * 故后端的 `ColumnUpdateIn` 里根本没有这一项（docs/DATASET_DESIGN.md §4.2）。
 * ⚠ 切来源时另外两档的字段一并清空落库，理由见 columnForm 的 `sharedFields`。
 */
import { computed, ref, watch } from 'vue'
import type { DatasetColumn } from '@dt/contracts'
import {
  DATASET_COLUMN_SOURCES,
  DATASET_COLUMN_TYPES,
  ERROR_CODES,
} from '@dt/contracts'
import {
  DtButton,
  DtInput,
  DtModal,
  DtNotice,
  DtNumberInput,
  DtSelect,
} from '@dt/ui'

import * as dataset from '@/api/dataset'
import { BizError } from '@/api/client'
import { describeError } from '@/composables/useAsyncList'
import { useFormDirty } from '@/composables/useFormDirty'
import ColumnSourceFormula from './ColumnSourceFormula.vue'
import ColumnSourceManual from './ColumnSourceManual.vue'
import ColumnSourcePoint from './ColumnSourcePoint.vue'
import {
  DECIMALS_MAX,
  DECIMALS_MIN,
  emptyColumnForm,
  formStateOf,
  hasNoError,
  KEY_MAX,
  NAME_MAX,
  suggestKey,
  toCreateInput,
  toPatchInput,
  UNIT_MAX,
  validateColumnForm,
  type ColumnFormErrors,
} from '../scripts/columnForm'
import { SOURCE_OPTIONS, sourceMeta, TYPE_OPTIONS } from '../scripts/columnView'

const NO_ERRORS: ColumnFormErrors = {
  key: '',
  name: '',
  nodeKey: '',
  formula: '',
}

const props = defineProps<{
  modelValue: boolean
  tableId: string
  column: DatasetColumn | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [message: string]
}>()

const form = ref(emptyColumnForm())
const errors = ref<ColumnFormErrors>({ ...NO_ERRORS })
const isKeyTyped = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)

// ⚠ 填了一半误点遮罩就全没了；脏着时由 DtModal 拦下误关
const { isDirty } = useFormDirty(
  () => form.value,
  () => props.modelValue,
)

const isEdit = computed(() => props.column !== null)
const sourceHint = computed(() => sourceMeta(form.value.source).hint)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    resetTo(props.column)
  },
  // ⚠ immediate：组件在「已经是打开态」时被挂载时，只监听变化的 watch 一次
  // 都不会跑，表单会是空的
  { immediate: true },
)

// 没手打过标识时跟着名称走；打过一次就再也不覆盖——正在填的框被改掉最气人
watch(
  () => form.value.name,
  (next) => {
    errors.value.name = ''
    if (isEdit.value || isKeyTyped.value) return
    form.value.key = suggestKey(next)
  },
)

function resetTo(column: DatasetColumn | null): void {
  form.value = formStateOf(column)
  errors.value = { ...NO_ERRORS }
  error.value = null
  // 编辑态的标识是既成事实，不该再被名称推着走
  isKeyTyped.value = column !== null
}

function onKeyInput(value: string): void {
  isKeyTyped.value = true
  errors.value.key = ''
  form.value.key = value
}

/** DtSelect 抛的是裸 string，用窄化收口而不是 `as` 断言。 */
function onSource(value: string): void {
  const found = DATASET_COLUMN_SOURCES.find((one) => one === value)
  if (found !== undefined) form.value.source = found
}

function onDataType(value: string): void {
  const found = DATASET_COLUMN_TYPES.find((one) => one === value)
  if (found !== undefined) form.value.dataType = found
}

/** 标识被占用是一句**指向某一格**的话，不该弹成通用失败。 */
function showFailure(caught: unknown): void {
  if (
    caught instanceof BizError &&
    caught.code === ERROR_CODES.datasetColumnKeyTaken
  ) {
    errors.value.key = '这张台账下已经有这个列标识了，换一个'
    return
  }
  error.value = describeError(caught)
}

async function save(): Promise<void> {
  const target = props.column
  if (target === null) {
    const created = await dataset.createDatasetColumn(
      props.tableId,
      toCreateInput(form.value),
    )
    emit('saved', `列「${created.name}」已新增`)
    return
  }
  await dataset.updateDatasetColumn(
    props.tableId,
    target.id,
    toPatchInput(form.value),
  )
  emit('saved', '列已更新')
}

async function onSubmit(): Promise<void> {
  const found = validateColumnForm(form.value, isEdit.value)
  errors.value = found
  if (!hasNoError(found)) return
  busy.value = true
  error.value = null
  try {
    await save()
    emit('update:modelValue', false)
  } catch (caught) {
    showFailure(caught)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <DtModal
    :model-value="props.modelValue"
    :dirty="isDirty"
    :title="isEdit ? '编辑列' : '新增列'"
    description="一列 = 一个字段：人工填的、从点位历史汇总的，或由公式算出来的"
    width="40rem"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DtInput
          v-model="form.name"
          label="列名称"
          required
          :error="errors.name"
          :maxlength="NAME_MAX"
        />
        <DtInput
          :model-value="form.key"
          label="列标识"
          required
          :disabled="isEdit"
          :error="errors.key"
          :maxlength="KEY_MAX"
          :hint="
            isEdit
              ? '建后不可改：它是数据行里的字段名，改了历史值就集体失联'
              : '公式里写作 {列标识}，可用中文'
          "
          @update:model-value="onKeyInput"
        />
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <DtSelect
          :model-value="form.dataType"
          label="数据类型"
          :options="TYPE_OPTIONS"
          @update:model-value="onDataType"
        />
        <DtInput v-model="form.unit" label="单位" :maxlength="UNIT_MAX" />
        <DtNumberInput
          v-model="form.decimals"
          label="小数位"
          :range="{ min: DECIMALS_MIN, max: DECIMALS_MAX }"
          hint="留空即不限。只影响展示，库里始终存全精度"
        />
      </div>

      <!-- 取值来源是这个弹窗的主要决策：单独起一段，下面整块跟着它变 -->
      <div
        class="flex flex-col gap-3 rounded-md border border-border-subtle p-3"
      >
        <DtSelect
          :model-value="form.source"
          label="取值来源"
          :options="SOURCE_OPTIONS"
          :hint="sourceHint"
          @update:model-value="onSource"
        />

        <ColumnSourceManual
          v-if="form.source === 'manual'"
          v-model:default-value="form.defaultValue"
          v-model:is-required="form.isRequired"
          :data-type="form.dataType"
        />
        <ColumnSourcePoint
          v-else-if="form.source === 'point'"
          v-model:node-key="form.nodeKey"
          v-model:agg="form.agg"
          :node-key-error="errors.nodeKey"
        />
        <ColumnSourceFormula
          v-else
          v-model:formula="form.formula"
          :formula-error="errors.formula"
        />
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
