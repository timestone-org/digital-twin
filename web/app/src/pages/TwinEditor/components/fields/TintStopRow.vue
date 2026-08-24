<script setup lang="ts">
/**
 * @fileoverview 状态染色的一档：命中条件 + 颜色 + 上下移删。
 *
 * ⚠ 区间的上界**不含**：`[60, 80)` 与 `[80, ∞)` 相邻时 80 归后一档。界面上把
 * 「含 / 不含」写出来，否则边界值归谁全靠猜，而猜错时画面上看不出任何异常。
 * ⚠ 颜色留空是有意义的一档：命中它就保持原色，且**不再往下比**——这是「正常时
 * 不染色、异常才染」最省事的写法。
 */
import { TWIN_TINT_MATCHES, type TwinTintStop } from '@dt/twin-config'
import {
  DtButton,
  DtColorInput,
  DtInput,
  DtNumberInput,
  DtSegmented,
} from '@dt/ui'

const props = defineProps<{
  modelValue: TwinTintStop
  /** 这一档在表里的序号，从 0 起。 */
  index: number
  /** 表里一共几档，用来禁掉首尾的移动按钮。 */
  total: number
  swatches: readonly string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [TwinTintStop]
  move: [number]
  remove: []
}>()

const MATCH_LABELS: Readonly<
  Record<(typeof TWIN_TINT_MATCHES)[number], string>
> = {
  range: '数值区间',
  equals: '等于某值',
}

const matchOptions = TWIN_TINT_MATCHES.map((value) => ({
  value,
  label: MATCH_LABELS[value],
}))

function write(patch: Partial<TwinTintStop>): void {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

function writeMatch(next: string): void {
  const match = TWIN_TINT_MATCHES.find((item) => item === next)
  if (match !== undefined) write({ match })
}
</script>

<template>
  <div
    class="flex flex-col gap-1.5 rounded border border-border-subtle bg-surface-sunken p-2"
  >
    <div class="flex items-center gap-1">
      <span class="min-w-0 flex-1 truncate text-xs text-text-secondary">
        第 {{ index + 1 }} 档
      </span>
      <DtButton
        size="xs"
        variant="ghost"
        intent="neutral"
        icon="chevron-up"
        :disabled="index === 0"
        aria-label="上移档位"
        title="上移档位"
        @click="emit('move', -1)"
      />
      <DtButton
        size="xs"
        variant="ghost"
        intent="neutral"
        icon="chevron-down"
        :disabled="index === total - 1"
        aria-label="下移档位"
        title="下移档位"
        @click="emit('move', 1)"
      />
      <DtButton
        size="xs"
        variant="ghost"
        intent="danger"
        icon="trash"
        aria-label="删除档位"
        title="删除档位"
        @click="emit('remove')"
      />
    </div>

    <DtSegmented
      :model-value="modelValue.match"
      :options="matchOptions"
      aria-label="命中方式"
      size="sm"
      @update:model-value="writeMatch"
    />

    <div v-if="modelValue.match === 'range'" class="flex items-center gap-1.5">
      <DtNumberInput
        class="min-w-0 flex-1"
        :model-value="modelValue.from ?? undefined"
        aria-label="下界（含）"
        placeholder="下界（含）"
        size="sm"
        :steppers="false"
        @update:model-value="write({ from: $event ?? null })"
      />
      <span class="shrink-0 text-xs text-text-disabled">≤ 值 &lt;</span>
      <DtNumberInput
        class="min-w-0 flex-1"
        :model-value="modelValue.to ?? undefined"
        aria-label="上界（不含）"
        placeholder="上界（不含）"
        size="sm"
        :steppers="false"
        @update:model-value="write({ to: $event ?? null })"
      />
    </div>
    <DtInput
      v-else
      :model-value="modelValue.equals"
      aria-label="等于"
      placeholder="等于（如 1 或 running）"
      size="sm"
      @update:model-value="write({ equals: $event })"
    />

    <DtColorInput
      :model-value="modelValue.color"
      aria-label="这一档的颜色"
      size="sm"
      placeholder="留空 = 命中但不染色"
      :swatches="swatches"
      @update:model-value="write({ color: $event })"
    />

    <DtInput
      :model-value="modelValue.label"
      aria-label="档位说明"
      placeholder="档位说明（图例上显示）"
      size="sm"
      @update:model-value="write({ label: $event })"
    />
  </div>
</template>
