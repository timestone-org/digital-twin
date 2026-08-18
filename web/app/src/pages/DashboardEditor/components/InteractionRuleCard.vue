<script setup lang="ts">
/**
 * @fileoverview 一条联动规则的编辑卡：头部是摘要与删除，下面是源节点 / 事件 /
 * 动作类型三档下拉，动作自己的字段交给 InteractionActionFields。
 */
import type {
  DtSelectOption,
  InteractionAction,
  InteractionRule,
} from '@dt/contracts'
import { DtButton, DtSelect } from '@dt/ui'

import InteractionActionFields from './InteractionActionFields.vue'
import {
  ACTION_OPTIONS,
  EVENT_OPTIONS,
  actionForType,
  isActionType,
  isEventName,
} from '../scripts/interactionOptions'

const props = defineProps<{
  rule: InteractionRule
  summary: string
  sourceOptions: readonly DtSelectOption[]
  targetOptions: readonly DtSelectOption[]
}>()

const emit = defineEmits<{
  update: [rule: InteractionRule]
  remove: [id: string]
}>()

function onSource(nodeId: string): void {
  emit('update', { ...props.rule, source: { ...props.rule.source, nodeId } })
}

function onEvent(raw: string): void {
  if (!isEventName(raw)) return
  emit('update', {
    ...props.rule,
    source: { ...props.rule.source, event: raw },
  })
}

function onActionType(raw: string): void {
  if (!isActionType(raw)) return
  const fallback = props.targetOptions[0]?.value ?? ''
  emit('update', {
    ...props.rule,
    action: actionForType(raw, props.rule.action, fallback),
  })
}

function onAction(action: InteractionAction): void {
  emit('update', { ...props.rule, action })
}

function onRemove(): void {
  emit('remove', props.rule.id)
}
</script>

<template>
  <section
    class="flex flex-col gap-2 rounded border border-border-subtle p-2"
    data-test="ix-rule"
  >
    <header class="flex items-center gap-2">
      <span
        class="min-w-0 flex-1 truncate text-xs text-text-primary"
        data-test="ix-summary"
      >
        {{ summary }}
      </span>
      <DtButton
        size="sm"
        variant="ghost"
        intent="danger"
        icon="trash"
        aria-label="删除这条联动"
        data-test="ix-remove"
        @click="onRemove"
      />
    </header>
    <DtSelect
      size="sm"
      label="事件源"
      :model-value="rule.source.nodeId"
      :options="sourceOptions"
      aria-label="事件源"
      @update:model-value="onSource"
    />
    <DtSelect
      size="sm"
      label="触发事件"
      :model-value="rule.source.event"
      :options="EVENT_OPTIONS"
      aria-label="触发事件"
      @update:model-value="onEvent"
    />
    <DtSelect
      size="sm"
      label="动作类型"
      :model-value="rule.action.type"
      :options="ACTION_OPTIONS"
      aria-label="动作类型"
      @update:model-value="onActionType"
    />
    <InteractionActionFields
      :action="rule.action"
      :target-options="targetOptions"
      @update="onAction"
    />
  </section>
</template>
