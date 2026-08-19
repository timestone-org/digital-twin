<script setup lang="ts">
/**
 * @fileoverview 把浏览树中勾选的节点批量导入为点位；逐行确认点位编码，并统一
 * 设置数据类型兜底、采样间隔与记录历史默认。
 *
 * ⚠ 「记录死区」写的是点位的 `deadband`：归档准入按它判定（变化幅度不超过它
 * 就不落库），单点位可后续在「点位设置」里改。
 * ⚠ 编码由寻址串推、中文名按拼音推、撞名自动挂序号，但推出来的**只是建议**：
 * 有一行不合法就不许提交——后端一批是原子的，一条编码不合规是整批被拒。
 */
import { computed, ref, watch } from 'vue'
import type {
  CollectDataType,
  CollectPointItemInput,
  DtNumberRange,
  DtSelectOption,
} from '@dt/contracts'
import { COLLECT_MIN_INTERVAL_MS } from '@dt/contracts'
import {
  DtButton,
  DtField,
  DtModal,
  DtNotice,
  DtNumberInput,
  DtSelect,
  DtSwitch,
} from '@dt/ui'

import { useFormDirty } from '@/composables/useFormDirty'
import type { ImportDraft } from '../scripts/importDrafts'
import { codeProblems, toPointItems } from '../scripts/importDrafts'
import ImportDraftRow from './ImportDraftRow.vue'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    drafts: readonly ImportDraft[]
    /** 库里已经用掉的编码，用来判重。 */
    takenCodes: ReadonlySet<string>
    loading?: boolean | undefined
  }>(),
  { loading: false },
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: [items: CollectPointItemInput[]]
}>()

const DATA_TYPES: readonly DtSelectOption[] = [
  { value: 'float', label: '浮点数' },
  { value: 'int', label: '整数' },
  { value: 'bool', label: '布尔' },
  { value: 'string', label: '字符串' },
]
const SAMPLING_RANGE: DtNumberRange = {
  min: COLLECT_MIN_INTERVAL_MS,
  step: 100,
}
const DEADBAND_RANGE: DtNumberRange = { min: 0, step: 0.1, precision: 3 }
// 下限是 0 而不是 1：0 是「跟随全局策略」这一档的表达，提交时落成 null
const RETENTION_RANGE: DtNumberRange = { min: 0, step: 1 }

const isBusy = computed(() => props.loading === true)

/** 本地可改的一份；改编码不该回写到浏览树上。 */
const rows = ref<ImportDraft[]>([])
const fallbackType = ref<CollectDataType>('float')
const samplingIntervalMs = ref(1000)
const archiveEnabled = ref(true)
const deadband = ref(0)
const retentionDays = ref(0)

// ⚠ 填了一半误点遮罩就全没了；脏着时由 DtModal 拦下误关
const { isDirty } = useFormDirty(
  [samplingIntervalMs, archiveEnabled, deadband, retentionDays, rows],
  () => props.modelValue,
)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    rows.value = props.drafts.map((draft) => ({ ...draft }))
    fallbackType.value = 'float'
    samplingIntervalMs.value = 1000
    archiveEnabled.value = true
    deadband.value = 0
    retentionDays.value = 0
  },
)

const count = computed(() => rows.value.length)
const problems = computed(() => codeProblems(rows.value, props.takenCodes))
const typeless = computed(
  () => rows.value.filter((row) => row.fieldType === null).length,
)

function setCode(index: number, code: string): void {
  const row = rows.value[index]
  if (row !== undefined) row.code = code
}

/** 提交前再判一次：编码有毛病就不发，后端一批原子，一条不合规是整批被拒。 */
function confirm(): void {
  if (isBusy.value || count.value === 0 || problems.value.size > 0) return
  emit(
    'confirm',
    toPointItems(rows.value, {
      fallbackType: fallbackType.value,
      samplingIntervalMs: samplingIntervalMs.value,
      archiveEnabled: archiveEnabled.value,
      deadband: deadband.value,
      retentionDays: retentionDays.value,
    }),
  )
}
</script>

<template>
  <DtModal
    :model-value="modelValue"
    :dirty="isDirty"
    title="导入选中节点"
    width="48rem"
    :close-on-backdrop="!isBusy"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex flex-col gap-3">
      <DtNotice v-if="problems.size > 0" intent="warning" icon="alert-triangle">
        有 {{ problems.size }} 行的编码要改。编码是点位的身份，只能用字母、
        数字与 . _ -；中文名已按拼音推了一个，可以直接改。
      </DtNotice>

      <p class="m-0 text-sm text-text-secondary">
        将导入
        <span class="text-accent-on-surface">{{ count }}</span>
        个节点为采集点位。
      </p>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DtField label="采样间隔（毫秒）" hint="统一应用到所有导入节点。">
          <DtNumberInput v-model="samplingIntervalMs" :range="SAMPLING_RANGE" />
        </DtField>
        <DtField
          label="没读到类型的按"
          :hint="`${typeless} 个节点没读到类型；现场读到的那些不受它影响。`"
        >
          <DtSelect v-model="fallbackType" :options="DATA_TYPES" />
        </DtField>
      </div>

      <!-- 记录历史默认（统一应用到本批全部节点；单点位可后续在表格里改） -->
      <label
        class="flex items-center justify-between rounded-md border border-border-subtle bg-surface-sunken/40 px-3 py-2.5"
      >
        <span class="text-sm text-text-secondary">导入后默认开启记录历史</span>
        <DtSwitch
          v-model="archiveEnabled"
          aria-label="导入后默认开启记录历史"
        />
      </label>
      <div v-if="archiveEnabled" class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DtField label="记录死区" hint="变化幅度不超过它就不落库；0 = 都记。">
          <DtNumberInput v-model="deadband" :range="DEADBAND_RANGE" />
        </DtField>
        <DtField label="保留期（天）" hint="0 = 跟随全局保留策略。">
          <DtNumberInput v-model="retentionDays" :range="RETENTION_RANGE" />
        </DtField>
      </div>

      <div
        class="max-h-72 overflow-y-auto rounded-md border border-border-subtle"
      >
        <ImportDraftRow
          v-for="(row, index) in rows"
          :key="row.address"
          :draft="row"
          :fallback-type="fallbackType"
          :problem="problems.get(row.address)"
          :disabled="isBusy"
          @update:code="setCode(index, $event)"
        />
      </div>
    </div>

    <template #footer>
      <DtButton
        variant="ghost"
        size="sm"
        :disabled="isBusy"
        @click="emit('update:modelValue', false)"
      >
        取消
      </DtButton>
      <DtButton
        size="sm"
        icon="download"
        :loading="isBusy"
        :disabled="count === 0 || problems.size > 0"
        @click="confirm"
      >
        导入 {{ count }} 个节点
      </DtButton>
    </template>
  </DtModal>
</template>
