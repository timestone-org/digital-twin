<script setup lang="ts">
/**
 * @fileoverview 一条绑定按来源种类要填的那几项。
 * ⚠ 常量的 `0` / `false` / `''` 都是合法取值：清空输入写的是 `null`（= 没配过），
 * 不许把 falsy 当成「没配」，否则一整屏的零值会消失。
 */
import type { BindingPayload, BindingSpec, ComputeOp, DtSelectOption } from '@dt/contracts'
import { COMPUTE_OPS } from '@dt/contracts'
import { DtButton, DtCheckbox, DtField, DtInput, DtNumberInput, DtSelect, DtSwitch, DtTag } from '@dt/ui'
import { computed } from 'vue'

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

function writeWindow(text: string): void {
  const nodeKey = props.binding.detailJson?.nodeKey ?? props.binding.nodeKey ?? ''
  emit('write', {
    ...props.binding,
    detailJson: { nodeKey, range: { lastWindow: text } },
  })
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <template v-if="binding.sourceKind === 'opcua'">
      <div class="flex items-center gap-2">
        <DtTag v-if="binding.nodeKey" size="sm" intent="info">
          {{ binding.nodeKey }}
        </DtTag>
        <span v-else class="text-2xs text-text-disabled">还没挑点位</span>
        <DtButton size="sm" variant="outline" icon="search" @click="emit('pick')">
          挑点位
        </DtButton>
      </div>
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

    <template v-else>
      <div class="flex items-center gap-2">
        <DtTag v-if="binding.detailJson" size="sm" intent="info">
          {{ binding.detailJson.nodeKey }}
        </DtTag>
        <span v-else class="text-2xs text-text-disabled">还没挑点位</span>
        <DtButton size="sm" variant="outline" icon="search" @click="emit('pick')">
          挑点位
        </DtButton>
      </div>
      <DtField label="相对窗（如 1h / 7d）" size="sm">
        <DtInput
          :model-value="window"
          size="sm"
          placeholder="1h"
          @update:model-value="writeWindow"
        />
      </DtField>
    </template>
  </div>
</template>
