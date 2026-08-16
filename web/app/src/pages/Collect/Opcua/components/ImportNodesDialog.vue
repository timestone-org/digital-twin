<script setup lang="ts">
/**
 * @fileoverview 把浏览树中勾选的节点批量导入为点位；可统一设置采样间隔与
 * 记录历史默认（应用到本批全部节点）。
 *
 * ⚠ 「记录死区」写的是点位的 `deadband`：归档准入按它判定（变化幅度不超过它
 * 就不落库），单点位可后续在「点位设置」里改。
 * ⚠ 编码由寻址串推、撞名自动挂序号，推不出合法编码的节点由父组件先行剔除并
 * 提示——这里收到的每一项都已经有编码。
 */
import { computed, ref, watch } from 'vue'
import type { CollectPointItemInput, DtNumberRange } from '@dt/contracts'
import { COLLECT_MIN_INTERVAL_MS } from '@dt/contracts'
import {
  DtButton,
  DtField,
  DtIcon,
  DtModal,
  DtNumberInput,
  DtSwitch,
} from '@dt/ui'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    items: readonly CollectPointItemInput[]
    loading?: boolean | undefined
  }>(),
  { loading: false },
)

const isBusy = computed(() => props.loading === true)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: [items: CollectPointItemInput[]]
}>()

const SAMPLING_RANGE: DtNumberRange = {
  min: COLLECT_MIN_INTERVAL_MS,
  step: 100,
}
const DEADBAND_RANGE: DtNumberRange = { min: 0, step: 0.1, precision: 3 }
// 下限是 0 而不是 1：0 是「跟随全局策略」这一档的表达，提交时落成 null
const RETENTION_RANGE: DtNumberRange = { min: 0, step: 1 }

const samplingIntervalMs = ref(1000)
/** 导入后默认开启记录历史 + 默认死区/保留期（统一应用到本批全部节点）。 */
const archiveEnabled = ref(true)
const deadband = ref(0)
const retentionDays = ref(0)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    samplingIntervalMs.value = 1000
    archiveEnabled.value = true
    deadband.value = 0
    retentionDays.value = 0
  },
)

const count = computed(() => props.items.length)

/** 组装批量导入项：统一的采样与记录历史默认套到每一项上。 */
function confirm(): void {
  if (isBusy.value || count.value === 0) return
  emit(
    'confirm',
    props.items.map((item) => ({
      ...item,
      sampling_interval_ms: samplingIntervalMs.value,
      archive_enabled: archiveEnabled.value,
      deadband: archiveEnabled.value ? deadband.value : 0,
      archive_retention_days:
        archiveEnabled.value && retentionDays.value > 0
          ? retentionDays.value
          : null,
    })),
  )
}
</script>

<template>
  <DtModal
    :model-value="modelValue"
    title="导入选中节点"
    width="36rem"
    :close-on-backdrop="!isBusy"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex flex-col gap-3">
      <p class="m-0 text-sm text-text-secondary">
        将导入
        <span class="text-accent-on-surface">{{ count }}</span>
        个节点为采集点位。
      </p>

      <DtField label="采样间隔（毫秒）" hint="统一应用到所有导入节点。">
        <DtNumberInput v-model="samplingIntervalMs" :range="SAMPLING_RANGE" />
      </DtField>

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
        class="max-h-64 overflow-y-auto rounded-md border border-border-subtle"
      >
        <div
          v-for="(item, index) in items"
          :key="item.address"
          class="flex items-center gap-2.5 border-b border-border-subtle px-3 py-2 text-xs last:border-0"
          :class="index % 2 === 1 && 'bg-surface-sunken/30'"
        >
          <DtIcon
            name="activity"
            :size="13"
            class="shrink-0 text-accent-secondary/80"
          />
          <span
            class="min-w-0 flex-1 truncate text-text-primary"
            :title="item.name"
          >
            {{ item.name }}
          </span>
          <span
            class="shrink-0 truncate font-mono text-2xs text-text-disabled"
            :title="item.address"
          >
            {{ item.address }}
          </span>
        </div>
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
        :disabled="count === 0"
        @click="confirm"
      >
        导入 {{ count }} 个节点
      </DtButton>
    </template>
  </DtModal>
</template>
