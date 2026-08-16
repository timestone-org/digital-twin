<script setup lang="ts">
/**
 * @fileoverview 运行参数弹窗里的一项：标签 + 档位/覆盖徽标 + 控件 + 说明与
 * 默认值。取值范围来自后端登记，这里不写死一份。
 */
import { computed } from 'vue'
import type { RuntimeParamItem } from '@dt/contracts'
import { DtNumberInput, DtSwitch, DtTag } from '@dt/ui'

import { TIER_TEXT } from '../runtimeParamsMeta'

const props = defineProps<{
  item: RuntimeParamItem
  draft: number | boolean | undefined
  disabled: boolean
}>()

const emit = defineEmits<{ change: [value: number | boolean] }>()

const range = computed(() => ({
  min: props.item.minimum,
  max: props.item.maximum,
  step: props.item.step,
}))

function onNumber(value: number | undefined): void {
  // 清空输入框不当成「设成 0」：不回写，数字框会自己滚回上一个合法值
  if (value === undefined) return
  emit('change', value)
}

function display(value: number | boolean | null): string {
  if (value === null) return '—'
  if (typeof value === 'boolean') return value ? '开' : '关'
  return String(value)
}
</script>

<template>
  <div
    class="flex min-w-0 flex-col gap-1.5 rounded-md border border-border-subtle px-3 py-2.5"
  >
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-sm font-semibold">{{ item.label }}</span>
      <DtTag
        size="sm"
        :intent="item.tier === 'instant' ? 'success' : 'warning'"
        :data-test="`tier-${item.key}`"
      >
        {{ TIER_TEXT[item.tier]?.label ?? item.tier }}
      </DtTag>
      <DtTag
        v-if="item.overridden"
        size="sm"
        intent="info"
        data-test="overridden-flag"
      >
        已覆盖
      </DtTag>
    </div>

    <div class="flex items-center gap-2">
      <DtSwitch
        v-if="item.kind === 'switch'"
        :model-value="Boolean(draft)"
        :disabled="disabled"
        :aria-label="item.label"
        :data-test="`field-${item.key}`"
        @update:model-value="emit('change', $event)"
      />
      <DtNumberInput
        v-else
        :model-value="Number(draft ?? 0)"
        :range="range"
        :unit="item.unit"
        :disabled="disabled"
        :aria-label="item.label"
        :data-test="`field-${item.key}`"
        @update:model-value="onNumber"
      />
    </div>

    <p class="m-0 text-xs leading-relaxed text-text-secondary">
      {{ item.hint }}
    </p>
    <p
      class="m-0 flex flex-wrap items-center gap-2 text-2xs text-text-disabled"
    >
      <DtTag size="sm" mono>{{ item.envName }}</DtTag>
      <span>默认 {{ display(item.defaultValue) }}</span>
      <span v-if="item.overridden && item.updatedBy">
        由 {{ item.updatedBy }} 改自 {{ display(item.previousValue) }}
      </span>
    </p>
  </div>
</template>
