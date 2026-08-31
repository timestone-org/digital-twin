<script setup lang="ts">
/**
 * @fileoverview 大屏联动规则编辑面：列规则、增删规则、改规则，每次改动把整份
 * 规则数组上抛，持久化由页面统一走大屏级 chromeJson。
 */
import { computed } from 'vue'
import type {
  DashboardNodePayload,
  InteractionEventName,
  InteractionRule,
  ModuleManifest,
} from '@dt/contracts'
import type { GetModuleManifest } from '@dt/runtime'
import { reconcileSetActiveGroups } from '@dt/runtime'
import { DtButton, DtEmpty } from '@dt/ui'

import { newClientUuid } from '@/api/idempotency'
import InteractionRuleCard from './InteractionRuleCard.vue'
import {
  isInteractiveSource,
  nodeOptionsOf,
  ruleSummary,
  ruleTouchesNode,
  supportedEventsOf,
} from '../scripts/interactionOptions'

const props = defineProps<{
  rules: readonly InteractionRule[]
  nodes: readonly DashboardNodePayload[]
  getManifest: GetModuleManifest
  /**
   * 只看与这个节点有关的规则（它当触发源，或它被某条规则控制）。
   * 缺省不给 = 大屏级全表。
   * ⚠ 增删改照旧对**整份**规则表操作：过滤只影响看得见哪几条，
   * 按可见子集写回会把别的节点的规则整批删掉。
   */
  focusNodeId?: string | undefined
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

/** 规则源节点的清单，事件选项按它过滤；源节点已删 / 类型未注册时给 undefined。 */
function manifestOf(rule: InteractionRule): ModuleManifest | undefined {
  const node = props.nodes.find((item) => item.id === rule.source.nodeId)
  return node === undefined ? undefined : props.getManifest(node.moduleType)
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

/** 页面上列出来的那几条。⚠ 写回永远走 `props.rules` 全表，不是这个子集。 */
const visibleRules = computed(() => {
  const focus = props.focusNodeId
  if (focus === undefined) return props.rules
  return props.rules.filter((rule) => ruleTouchesNode(rule, focus))
})

/** 选中的节点自己能当触发源时，新规则默认从它出发。 */
const defaultSourceId = computed(() => {
  const focus = props.focusNodeId
  const options = sourceOptions.value
  if (focus !== undefined && options.some((item) => item.value === focus)) {
    return focus
  }
  return options[0]?.value
})

/** 有没有任何节点能当触发源；没有就只能看，不能新增。 */
const canAdd = computed(() => defaultSourceId.value !== undefined)

/**
 * 新规则的触发事件：取源模块自报的第一档。
 * ⚠ 不许恒给 `click`：只发 `select` 的控件（页签栏、2D 孪生）会当场拿到一条
 * 永远不触发的规则，而面板上只在下拉里标一句「该模块不会发出此事件」。
 * @param nodeId 事件源节点
 */
function defaultEventOf(nodeId: string): InteractionEventName {
  const node = props.nodes.find((item) => item.id === nodeId)
  const manifest =
    node === undefined ? undefined : props.getManifest(node.moduleType)
  return supportedEventsOf(manifest)[0] ?? 'click'
}

function addRule(): void {
  const nodeId = defaultSourceId.value
  if (nodeId === undefined) return
  commit([
    ...props.rules,
    {
      id: newClientUuid(),
      source: { nodeId, event: defaultEventOf(nodeId) },
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
    <!-- ⚠ 「没有可交互的模块」只挡新增，不挡列表：一个自己不能当触发源的模块，
         照样可以被别的模块的规则控制显隐，那些规则必须看得见 -->
    <DtEmpty
      v-if="canAdd === false && visibleRules.length === 0"
      icon="activity"
      title="没有可交互的模块"
      hint="画布上还没有可交互的模块（文字 / 图片块这类），先摆一个能点的模块再配联动"
      data-test="ix-empty"
    />
    <template v-else>
      <p
        v-if="visibleRules.length === 0"
        class="m-0 text-2xs text-text-disabled"
        data-test="ix-no-rule"
      >
        {{
          focusNodeId === undefined ? '还没有联动规则' : '这个模块还没有联动'
        }}
      </p>
      <InteractionRuleCard
        v-for="rule in visibleRules"
        :key="rule.id"
        :rule="rule"
        :summary="summaryOf(rule)"
        :source-options="sourceOptions"
        :target-options="targetOptions"
        :source-manifest="manifestOf(rule)"
        @update="updateRule"
        @remove="removeRule"
      />
      <DtButton
        v-if="canAdd"
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
