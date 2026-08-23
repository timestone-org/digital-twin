<script setup lang="ts">
/**
 * @fileoverview 新建 / 编辑台账的弹窗。
 *
 * ⚠ 编码只在新建时可填：它是大屏绑定键 `ds:{code}:{列key}` 的前半段，建后再改
 * 会让已配好的大屏绑定全部悬空，后端的 `TableUpdateIn` 里因此根本没有这一项。
 * ⚠ 周期以**秒**呈现、以毫秒落库：让人对着 60000 数零没有必要。
 */
import { computed, ref, watch } from 'vue'
import type {
  DatasetCollectMode,
  DatasetTableSummary,
  DtSelectOption,
} from '@dt/contracts'
import { DATASET_COLLECT_MODES, ERROR_CODES } from '@dt/contracts'
import {
  DtButton,
  DtInput,
  DtModal,
  DtNotice,
  DtNumberInput,
  DtSelect,
  DtSwitch,
  DtTextarea,
} from '@dt/ui'

import * as dataset from '@/api/dataset'
import { BizError } from '@/api/client'
import { describeError } from '@/composables/useAsyncList'
import { useFormDirty } from '@/composables/useFormDirty'
import {
  DEFAULT_INTERVAL_S,
  DESCRIPTION_MAX,
  formStateOf,
  INTERVAL_S_MAX,
  INTERVAL_S_MIN,
  NAME_MAX,
  suggestCode,
  toCreateInput,
  toPatchInput,
  validateTableForm,
  type TableFormState,
} from '../scripts/tableForm'

const COLLECT_MODES: readonly DtSelectOption[] = [
  { value: 'manual', label: '人工录入' },
  { value: 'aggregate', label: '自动采集（从点位历史汇总）' },
]

const props = defineProps<{
  modelValue: boolean
  table: DatasetTableSummary | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [message: string]
}>()

const code = ref('')
const name = ref('')
const description = ref('')
const collectMode = ref<DatasetCollectMode>('manual')
const intervalSeconds = ref<number | undefined>(DEFAULT_INTERVAL_S)
const retentionDays = ref<number | undefined>(undefined)
const isEnabled = ref(true)
const codeError = ref('')
const nameError = ref('')
const isCodeTyped = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)

// ⚠ 填了一半误点遮罩就全没了；脏着时由 DtModal 拦下误关
const { isDirty } = useFormDirty(
  [
    code,
    name,
    description,
    collectMode,
    intervalSeconds,
    retentionDays,
    isEnabled,
  ],
  () => props.modelValue,
)

const isEdit = computed(() => props.table !== null)
const state = computed<TableFormState>(() => ({
  code: code.value,
  name: name.value,
  description: description.value,
  collectMode: collectMode.value,
  intervalSeconds: intervalSeconds.value,
  retentionDays: retentionDays.value,
  isEnabled: isEnabled.value,
}))

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    resetTo(props.table)
  },
  // ⚠ immediate：组件在「已经是打开态」时被挂载时，只监听变化的 watch 一次
  // 都不会跑，表单会是空的
  { immediate: true },
)

// 没手打过编码时跟着名称走；打过一次就再也不覆盖——正在填的框被改掉最气人
watch(name, (next) => {
  nameError.value = ''
  if (isEdit.value || isCodeTyped.value) return
  code.value = suggestCode(next)
})

function resetTo(table: DatasetTableSummary | null): void {
  const next = formStateOf(table)
  error.value = null
  codeError.value = ''
  nameError.value = ''
  // 编辑态的编码是既成事实，不该再被名称推着走
  isCodeTyped.value = table !== null
  code.value = next.code
  name.value = next.name
  description.value = next.description
  collectMode.value = next.collectMode
  intervalSeconds.value = next.intervalSeconds
  retentionDays.value = next.retentionDays
  isEnabled.value = next.isEnabled
}

/** DtSelect 抛的是 string，用窄化收口而不是 `as` 断言。 */
function onCollectMode(value: string): void {
  const found = DATASET_COLLECT_MODES.find((mode) => mode === value)
  if (found !== undefined) collectMode.value = found
}

function onCodeInput(value: string): void {
  isCodeTyped.value = true
  codeError.value = ''
  code.value = value
}

/** 编码被占用是一句**指向某一格**的话，不该弹成通用失败。 */
function showFailure(caught: unknown): void {
  if (
    caught instanceof BizError &&
    caught.code === ERROR_CODES.datasetTableCodeTaken
  ) {
    codeError.value = '这个编码已被占用，换一个'
    return
  }
  error.value = describeError(caught)
}

async function save(): Promise<void> {
  const target = props.table
  if (target === null) {
    const created = await dataset.createDatasetTable(toCreateInput(state.value))
    emit('saved', `台账「${created.name}」已创建`)
    return
  }
  await dataset.updateDatasetTable(target.id, toPatchInput(state.value))
  emit('saved', '台账已更新')
}

async function onSubmit(): Promise<void> {
  const found = validateTableForm(state.value, isEdit.value)
  codeError.value = found.code
  nameError.value = found.name
  if (found.code !== '' || found.name !== '') return
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
    :title="isEdit ? '编辑台账' : '新建台账'"
    description="一张台账就是一份自定义表结构：先建表，再给它配列"
    width="34rem"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
      <DtInput
        v-model="name"
        label="台账名称"
        required
        :error="nameError"
        :maxlength="NAME_MAX"
      />
      <DtInput
        :model-value="code"
        label="台账编码"
        required
        :disabled="isEdit"
        :error="codeError"
        :hint="
          isEdit
            ? '建后不可改：大屏绑定键 ds:编码:列标识 依赖它'
            : '英文标识，全局唯一；大屏绑定键写作 ds:编码:列标识'
        "
        @update:model-value="onCodeInput"
      />
      <DtTextarea
        v-model="description"
        label="说明"
        :maxlength="DESCRIPTION_MAX"
        hint="这张台账记什么、谁来填、多久填一次"
      />
      <DtSelect
        :model-value="collectMode"
        label="取数方式"
        :options="COLLECT_MODES"
        hint="人工录入的行由人填；自动采集按周期从点位历史汇总"
        @update:model-value="onCollectMode"
      />
      <DtNumberInput
        v-if="collectMode === 'aggregate'"
        v-model="intervalSeconds"
        label="台账周期"
        unit="秒"
        :range="{ min: INTERVAL_S_MIN, max: INTERVAL_S_MAX }"
        hint="一行覆盖多长的时间桶。上限 1 天：更长的桶宽两侧对齐口径尚未在真库验过"
      />
      <DtNumberInput
        v-model="retentionDays"
        label="保留期"
        unit="天"
        :range="{ min: 1 }"
        hint="留空即永久保留"
      />
      <DtSwitch v-model="isEnabled" label="启用" />
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
