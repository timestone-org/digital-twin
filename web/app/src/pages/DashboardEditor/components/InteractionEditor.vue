<script setup lang="ts">
/**
 * @fileoverview 大屏联动规则编辑面：列规则、增删规则、改规则，每次改动把整份
 * 规则数组上抛，持久化由页面统一走大屏级 chromeJson。
 */
import { computed } from 'vue'
import type { DashboardNodePayload, InteractionRule } from '@dt/contracts'
import type { GetModuleManifest } from '@dt/runtime'
import { reconcileSetActiveGroups } from '@dt/runtime'
import { DtButton, DtEmpty } from '@dt/ui'

import { newClientUuid } from '@/api/idempotency'
import InteractionRuleCard from './InteractionRuleCard.vue'
import {
  isInteractiveSource,
  nodeOptionsOf,
  ruleSummary,
} from './interactionOptions'

const props = defineProps<{
  rules: readonly InteractionRule[]
  nodes: readonly DashboardNodePayload[]
  getManifest: GetModuleManifest
}>()

const emit = defineEmits<{ 'update:rules': [rules: InteractionRule[]] }>()

const sourceOptions = computed(() =>
  nodeOptionsOf(
    props.nodes.filter((node) => isInteractiveSource(node, props.getManifest)),
    props.getManifest,
  ),
)

// 目标可以是任意节点：被控制的一方不需要自己会响应交互
const targetOptions = computed(() =>
  nodeOptionsOf(props.nodes, props.getManifest),
)

const labels = computed(
  () =>
    new Map(targetOptions.value.map((option) => [option.value, option.label])),
)

/** 摘要用的显示名；节点已被删掉时回落 id，否则那条悬空规则在列表里没法辨认。 */
function labelOf(nodeId: string): string {
  return labels.value.get(nodeId) ?? nodeId
}

function summaryOf(rule: InteractionRule): string {
  return ruleSummary(rule, labelOf)
}

/**
 * 源控件当前的选项集。
 * ⚠ 恒给 null（规则原样不动）：分段类控件的选项集还没接到这一层；
 * 接上之后陈旧组会在这里被清掉，调用点不用改。
 */
function itemsOfSource(): readonly string[] | null {
  return null
}

/** 一切增删改都从这里出口，保证陈旧的互斥组不会跟着上抛。 */
function commit(next: InteractionRule[]): void {
  emit('update:rules', reconcileSetActiveGroups(next, itemsOfSource))
}

function addRule(): void {
  const first = sourceOptions.value[0]
  if (first === undefined) return
  commit([
    ...props.rules,
    {
      id: newClientUuid(),
      source: { nodeId: first.value, event: 'click' },
      action: { type: 'show', targets: [] },
    },
  ])
}

function updateRule(next: InteractionRule): void {
  commit(props.rules.map((rule) => (rule.id === next.id ? next : rule)))
}

function removeRule(id: string): void {
  commit(props.rules.filter((rule) => rule.id !== id))
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <DtEmpty
      v-if="sourceOptions.length === 0"
      icon="activity"
      title="没有可交互的模块"
      hint="画布上还没有可交互的模块（文字 / 图片块这类），先摆一个能点的模块再配联动"
      data-test="ix-empty"
    />
    <template v-else>
      <p
        v-if="rules.length === 0"
        class="m-0 text-2xs text-text-disabled"
        data-test="ix-no-rule"
      >
        还没有联动规则
      </p>
      <InteractionRuleCard
        v-for="rule in rules"
        :key="rule.id"
        :rule="rule"
        :summary="summaryOf(rule)"
        :source-options="sourceOptions"
        :target-options="targetOptions"
        @update="updateRule"
        @remove="removeRule"
      />
      <DtButton
        size="sm"
        variant="outline"
        icon="plus"
        data-test="ix-add"
        @click="addRule"
      >
        新增规则
      </DtButton>
    </template>
  </div>
</template>
