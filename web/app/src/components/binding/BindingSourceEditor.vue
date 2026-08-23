<script setup lang="ts">
/**
 * @fileoverview 一条绑定按来源种类要填的那几项。
 * ⚠ 常量的 `0` / `false` / `''` 都是合法取值：清空输入写的是 `null`（= 没配过），
 * 不许把 falsy 当成「没配」，否则一整屏的零值会消失。
 * ⚠ 五种来源**逐档显式列出**，末尾那一档是「没有认出的来源」而不是某一种来源：
 * 用 `v-else` 兜底的话，再加一种来源会安静地画成上一种的表单，
 * 用户填得完、也存得下，只是存的是另一种来源的字段。契约测试逐档钉死。
 */
import type {
  BindingPayload,
  BindingSpec,
  ComputeOp,
  DtSelectOption,
} from '@dt/contracts'
import { COMPUTE_OPS } from '@dt/contracts'
import {
  DtCheckbox,
  DtField,
  DtInput,
  DtNotice,
  DtNumberInput,
  DtSelect,
  DtSwitch,
} from '@dt/ui'
import { computed } from 'vue'

import DatasetRefField from './DatasetRefField.vue'
import PointRefField from './PointRefField.vue'

const props = defineProps<{
  spec: BindingSpec
  binding: BindingPayload
  /** 同节点内其它槽的 fieldKey，派生绑定从中挑输入。 */
  siblingKeys: readonly string[]
}>()

const emit = defineEmits<{
  write: [binding: BindingPayload]
  pick: []
}>()

const OP_OPTIONS: readonly DtSelectOption[] = COMPUTE_OPS.map((op) => ({
  value: op,
  label: op,
}))

const staticText = computed(() =>
  typeof props.binding.staticValueJson === 'string'
    ? props.binding.staticValueJson
    : '',
)
const staticNumber = computed(() =>
  typeof props.binding.staticValueJson === 'number'
    ? props.binding.staticValueJson
    : undefined,
)
const staticBoolean = computed(() => props.binding.staticValueJson === true)

const computeInputs = computed<readonly string[]>(
  () => props.binding.computeJson?.inputs ?? [],
)
const computeOp = computed<string>(() => props.binding.computeJson?.op ?? 'sum')

const window = computed(() => props.binding.detailJson?.range.lastWindow ?? '')

function writeStatic(value: unknown): void {
  emit('write', { ...props.binding, staticValueJson: value })
}

function writeOp(raw: string): void {
  const op = COMPUTE_OPS.find((item) => item === raw)
  if (op === undefined) return
  emit('write', {
    ...props.binding,
    computeJson: { op, inputs: [...computeInputs.value] },
  })
}

function toggleInput(key: string, on: boolean): void {
  const next = on
    ? [...computeInputs.value, key]
    : computeInputs.value.filter((item) => item !== key)
  const op: ComputeOp = props.binding.computeJson?.op ?? 'sum'
  emit('write', { ...props.binding, computeJson: { op, inputs: next } })
}

/** 点位历史那一支的点位身份；这条绑定不是那一支时给空串。 */
const archiveNodeKey = computed(() => {
  const detail = props.binding.detailJson
  return detail !== null && 'nodeKey' in detail ? detail.nodeKey : ''
})

/** 台账那一支的列身份；这条绑定不是那一支时给空串。 */
const datasetKey = computed(() => {
  const detail = props.binding.detailJson
  return detail !== null && 'datasetKey' in detail ? detail.datasetKey : ''
})

function writeWindow(text: string): void {
  const range = { lastWindow: text }
  // ⚠ 按当前来源写回对应的那一支，绝不「保留原样只换 range」：换过来源之后
  // 原来那一支的身份串还躺在 detailJson 里，原样带过去就是拿点位身份当台账
  // 列身份用，取数永远落空而界面上什么都看不出来
  const detailJson =
    props.binding.sourceKind === 'dataset'
      ? { datasetKey: datasetKey.value, range }
      : {
          nodeKey: archiveNodeKey.value || (props.binding.nodeKey ?? ''),
          range,
        }
  emit('write', { ...props.binding, detailJson })
}

/** 挑好台账列之后写回身份串，时间窗保持不变。 */
function writeDatasetKey(key: string): void {
  emit('write', {
    ...props.binding,
    // 时间窗留空时不写这个字段，而不是写一个 undefined 进去：
    // 后端收到的是一个「配过但没值」的 range，与「没配过」不是一回事
    detailJson: {
      datasetKey: key,
      range: window.value === '' ? {} : { lastWindow: window.value },
    },
  })
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <template v-if="binding.sourceKind === 'opcua'">
      <PointRefField :node-key="binding.nodeKey ?? ''" @pick="emit('pick')" />
    </template>

    <template v-else-if="binding.sourceKind === 'static'">
      <DtNumberInput
        v-if="spec.dataType === 'number'"
        :model-value="staticNumber"
        size="sm"
        @update:model-value="writeStatic($event ?? null)"
      />
      <DtSwitch
        v-else-if="spec.dataType === 'boolean'"
        :model-value="staticBoolean"
        size="sm"
        :aria-label="spec.label"
        @update:model-value="writeStatic($event)"
      />
      <DtInput
        v-else
        :model-value="staticText"
        size="sm"
        placeholder="常量值"
        @update:model-value="writeStatic($event)"
      />
    </template>

    <template v-else-if="binding.sourceKind === 'computed'">
      <DtField label="运算" size="sm">
        <DtSelect
          :model-value="computeOp"
          :options="OP_OPTIONS"
          size="sm"
          aria-label="运算"
          @update:model-value="writeOp"
        />
      </DtField>
      <DtCheckbox
        v-for="key in siblingKeys"
        :key="key"
        :model-value="computeInputs.includes(key)"
        :label="key"
        size="sm"
        @update:model-value="toggleInput(key, $event)"
      />
    </template>

    <template v-else-if="binding.sourceKind === 'archive'">
      <PointRefField :node-key="archiveNodeKey" @pick="emit('pick')" />
      <DtField label="相对窗（如 1h / 7d）" size="sm">
        <DtInput
          :model-value="window"
          size="sm"
          placeholder="1h"
          @update:model-value="writeWindow"
        />
      </DtField>
    </template>

    <template v-else-if="binding.sourceKind === 'dataset'">
      <DatasetRefField :dataset-key="datasetKey" @pick="writeDatasetKey" />
      <DtField label="相对窗（如 1h / 7d）" size="sm">
        <DtInput
          :model-value="window"
          size="sm"
          placeholder="1h"
          @update:model-value="writeWindow"
        />
      </DtField>
    </template>

    <DtNotice v-else intent="danger" icon="alert-triangle">
      没有认出的绑定来源「{{ binding.sourceKind }}」，这条绑定填不了。
    </DtNotice>
  </div>
</template>
