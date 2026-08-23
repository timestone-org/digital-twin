<script setup lang="ts">
/**
 * @fileoverview 形参表：调用点按这里的顺序填实参，公式体里写作 `{形参名}`。
 *
 * ⚠ 两档形参差在**实参能是什么**：`column` 只收裸列引用（`PREV` / `*_OVER` /
 * `*_ALL` 要知道是哪一列），`value` 收任意表达式。
 * ⚠ **`value` 形参的默认值不是界面预填**：它是「这个位置该放什么」的唯一声明。
 * 落在只收字面量的位置（时间窗、`PREV` 的期数）而没有默认值，保存必然失败，
 * 且后端报的是「时间窗必须是字符串字面量」——那句话说的是校验用的样例调用，
 * 而要改的是这一格（docs/DATASET_DESIGN.md §5.11）。所以提示写在这里。
 */
import type { DtSelectOption } from '@dt/contracts'
import { DtButton, DtInput, DtNotice, DtSelect } from '@dt/ui'

import {
  PARAM_HINT_MAX,
  PARAM_LABEL_MAX,
  PARAMS_MAX,
  lacksDefault,
  paramDefaultText,
  parseParamDefault,
  toParamKind,
  type ParamDraft,
} from '../scripts/formulaForm'

const KINDS: readonly DtSelectOption[] = [
  { value: 'column', label: '列引用' },
  { value: 'value', label: '取值' },
]

const props = defineProps<{
  params: readonly ParamDraft[]
  /** 形参表整体的问题（重名、字符集、超量）。 */
  error: string
  disabled: boolean
}>()

const emit = defineEmits<{
  update: [params: ParamDraft[]]
  /** 加一行。行号由弹窗那边发——计数器归它，不归这里 */
  add: []
}>()

/** 改一格：整表换成新数组，不就地改 prop。 */
function patch(rowId: string, change: Partial<ParamDraft>): void {
  emit(
    'update',
    props.params.map((param) =>
      param.rowId === rowId ? { ...param, ...change } : { ...param },
    ),
  )
}

function onKind(rowId: string, value: string): void {
  const kind = toParamKind(value)
  if (kind !== undefined) patch(rowId, { kind })
}

function remove(rowId: string): void {
  emit(
    'update',
    props.params.filter((param) => param.rowId !== rowId),
  )
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-2">
      <span class="text-xs text-text-secondary">
        形参 · 公式体里写作 {形参名}，调用时按顺序填
      </span>
      <DtButton
        variant="ghost"
        intent="neutral"
        size="sm"
        icon="plus"
        :disabled="props.disabled || props.params.length >= PARAMS_MAX"
        @click="emit('add')"
      >
        加一个
      </DtButton>
    </div>

    <p v-if="props.params.length === 0" class="text-xs text-text-secondary">
      还没有形参。没有形参的公式是一个常量式子，多数情况下至少要有一个。
    </p>

    <div
      v-for="param in props.params"
      :key="param.rowId"
      class="grid grid-cols-[1fr_7rem_1fr_1.4fr_auto] items-start gap-1.5"
    >
      <DtInput
        :model-value="param.name"
        size="sm"
        placeholder="形参名，如 本期"
        aria-label="形参名"
        :disabled="props.disabled"
        @update:model-value="patch(param.rowId, { name: $event })"
      />
      <DtSelect
        :model-value="param.kind"
        size="sm"
        :options="KINDS"
        aria-label="形参档位"
        :disabled="props.disabled"
        @update:model-value="onKind(param.rowId, $event)"
      />
      <DtInput
        :model-value="param.label"
        size="sm"
        placeholder="显示名"
        aria-label="形参显示名"
        :maxlength="PARAM_LABEL_MAX"
        :disabled="props.disabled"
        @update:model-value="patch(param.rowId, { label: $event })"
      />
      <DtInput
        v-if="param.kind === 'value'"
        :model-value="paramDefaultText(param.default)"
        size="sm"
        placeholder="默认值（时间窗 / 期数位必填）"
        aria-label="形参默认值"
        :error="lacksDefault(param) ? '落在时间窗或期数上时必填' : ''"
        :disabled="props.disabled"
        @update:model-value="
          patch(param.rowId, { default: parseParamDefault($event) })
        "
      />
      <DtInput
        v-else
        :model-value="param.hint"
        size="sm"
        placeholder="填写提示"
        aria-label="形参填写提示"
        :maxlength="PARAM_HINT_MAX"
        :disabled="props.disabled"
        @update:model-value="patch(param.rowId, { hint: $event })"
      />
      <DtButton
        variant="ghost"
        intent="danger"
        size="sm"
        icon="trash"
        :aria-label="`删除形参 ${param.name}`"
        :disabled="props.disabled"
        @click="remove(param.rowId)"
      />
    </div>

    <DtNotice v-if="props.error" intent="danger">{{ props.error }}</DtNotice>

    <p
      v-if="props.params.some((param) => param.kind === 'value')"
      class="text-xs leading-relaxed text-text-secondary"
    >
      取值形参若用在时间窗或 PREV 的期数上，默认值必填——校验拿它代入样例调用，
      缺了这条公式就存不下来。时间窗直接写 24h（不要加引号，引号由后端补），
      期数写数字如 12。
    </p>
  </div>
</template>
