<script setup lang="ts">
/**
 * @fileoverview 一台空调的「数据与达标」：读哪个外部对象，以及各指标的达标范围。
 *
 * 两段各自保存，走的是两个端点、两种语义——凑成一个「保存」按钮的话，一段成功
 * 一段失败时没法说清到底存进去了什么。
 * ⚠ 达标范围的 PUT 是覆盖式的：这里提交的永远是**全部**可配指标，留空的送
 * null 由后端删掉。少送一项等于把它清了。
 */
import { computed, watch } from 'vue'
import type { AcUnit } from '@dt/contracts'
import {
  DtButton,
  DtInput,
  DtModal,
  DtNotice,
  DtSelect,
  DtSpinner,
  useConfirm,
  useToast,
} from '@dt/ui'

import { implausibleWarnings } from '../acLimitForm'
import { useAcDataConfig } from '../useAcDataConfig'

const props = defineProps<{
  modelValue: boolean
  unit: AcUnit | null
}>()

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const toast = useToast()
const confirm = useConfirm()
const config = useAcDataConfig(() => props.unit?.id ?? '')

const title = computed(() =>
  props.unit === null ? '数据与达标' : `数据与达标 · ${props.unit.serial}`,
)
const hasDatasetChoice = computed(() => config.datasetOptions.value.length > 1)
// 只提醒不拦截：范围是用户自己定的，但「看着不像这个量」值得说一声
const warnings = computed(() => implausibleWarnings(config.rows.value))

// immediate 兼作初值：组件在「已经是打开态」时被挂载时，只监听变化的 watch 一次都不跑
watch(
  () => [props.modelValue, props.unit?.id] as const,
  ([open]) => {
    if (open && props.unit !== null) void config.load()
  },
  { immediate: true },
)

async function onSaveBinding(): Promise<void> {
  if (await config.saveBinding()) toast.success('数据源已绑定')
}

async function onRemoveBinding(): Promise<void> {
  const confirmed = await confirm.ask({
    title: '解除绑定',
    message: `解除后这台空调将读不到「${config.dataset.value?.name ?? ''}」，已存的达标范围不受影响。`,
    confirmText: '解除绑定',
    danger: true,
  })
  if (!confirmed) return
  if (await config.removeBinding()) toast.success('绑定已解除')
}

async function onSaveLimits(): Promise<void> {
  if (await config.saveLimits()) toast.success('达标范围已保存')
}
</script>

<template>
  <DtModal
    :model-value="props.modelValue"
    :title="title"
    description="配置这台空调的数据来源与各指标的达标范围"
    width="38rem"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex flex-col gap-6">
      <DtSpinner v-if="config.loading.value" label="正在读取当前配置" />

      <section class="flex flex-col gap-3">
        <h3 class="text-sm font-medium">数据源绑定</h3>
        <DtSelect
          v-if="hasDatasetChoice"
          :model-value="config.datasetKey.value"
          label="数据集"
          :options="config.datasetOptions.value"
          @update:model-value="config.selectDataset($event)"
        />
        <p v-else-if="config.dataset.value" class="text-xs text-secondary">
          {{ config.dataset.value.name }} ——
          {{ config.dataset.value.description }}
        </p>
        <DtSelect
          v-model="config.sourceObject.value"
          label="数据源对象"
          :disabled="config.loadingObjects.value"
          :options="config.objectOptions.value"
          :display="{
            placeholder: '选择外部库里的一个对象',
            emptyText: '外部库里没有列结构匹配的对象',
          }"
          hint="只列出列结构与该数据集相符的对象，因此不能手填"
        />
        <div class="flex items-center gap-2">
          <DtButton
            size="sm"
            :loading="config.busy.value"
            :disabled="config.sourceObject.value === ''"
            @click="onSaveBinding"
          >
            保存绑定
          </DtButton>
          <DtButton
            v-if="config.boundObject.value !== ''"
            size="sm"
            variant="ghost"
            intent="danger"
            :loading="config.busy.value"
            @click="onRemoveBinding"
          >
            解除绑定
          </DtButton>
        </div>
      </section>

      <section class="flex flex-col gap-3">
        <h3 class="text-sm font-medium">达标范围</h3>
        <p class="text-xs text-secondary">
          留空表示该侧不限制。保存的是全部指标，清空即视为取消该项。
        </p>
        <!-- ⚠ 一行一个指标、名字只说一次，两个框摆成「下限 ～ 上限」的区间：
           上一版是每个指标一个 2×2 的数字方阵，两条轴（指标 / 上下限）谁横谁竖
           全靠标签区分，现场 17 台全部把两条轴读反了。区间式没有第二条轴可读反。 -->
        <div
          v-for="row in config.rows.value"
          :key="row.metric"
          class="flex flex-wrap items-end gap-2"
        >
          <span class="w-32 shrink-0 pb-2 text-xs text-text-primary">
            {{ row.name }}（{{ row.unit }}）
          </span>
          <DtInput
            v-model="row.lower"
            class="w-24"
            size="sm"
            inputmode="decimal"
            label="下限"
            :aria-label="`${row.name}下限（${row.unit}）`"
            placeholder="不限"
          />
          <span class="pb-2 text-text-disabled">～</span>
          <DtInput
            v-model="row.upper"
            class="w-24"
            size="sm"
            inputmode="decimal"
            label="上限"
            :aria-label="`${row.name}上限（${row.unit}）`"
            placeholder="不限"
          />
        </div>
        <DtNotice v-for="text in warnings" :key="text" intent="warning">
          {{ text }}
        </DtNotice>
        <DtNotice v-if="config.rows.value.length === 0" intent="info">
          这个数据集里没有可配达标范围的指标。
        </DtNotice>
        <div>
          <DtButton
            size="sm"
            :loading="config.busy.value"
            @click="onSaveLimits"
          >
            保存达标范围
          </DtButton>
        </div>
      </section>

      <DtNotice v-if="config.error.value" intent="danger">
        {{ config.error.value }}
      </DtNotice>
    </div>

    <template #footer>
      <DtButton
        variant="ghost"
        intent="neutral"
        @click="emit('update:modelValue', false)"
      >
        关闭
      </DtButton>
    </template>
  </DtModal>
</template>
