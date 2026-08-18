<script setup lang="ts">
/**
 * @fileoverview 钻取节点检查器：名字、图标、上一层、关联 3D 节点、进入取景、
 * 字段与摘要勾选、钻取页标题、隐藏子项列表。
 *
 * ⚠ `nodes` 留空**不是**「没有几何」，是「取全部子孙的并集」——厂区、车间这种
 * 上层本来就没有属于自己的模型节点。
 * ⚠ `view` 有值时 `cameraId` 静默不生效，界面上必须摆明。
 */
import type { TwinCamera, TwinHierNode, TwinModalView } from '@dt/twin-config'
import { hierEffectiveNodes, hierPathOf } from '@dt/twin-config'
import {
  DtButton,
  DtField,
  DtInput,
  DtNotice,
  DtSelect,
  DtSwitch,
} from '@dt/ui'
import { computed } from 'vue'

import { hierChildCount, hierParentCandidates } from '../../scripts/hierRows'
import HierFieldList from '../fields/HierFieldList.vue'
import IconPicker from '../fields/IconPicker.vue'
import InspectorSection from '../fields/InspectorSection.vue'
import NodePicker from '../fields/NodePicker.vue'

const props = defineProps<{
  modelValue: TwinHierNode
  /** 全部钻取节点，选上一层与算路径要用。 */
  nodes: readonly TwinHierNode[]
  /** 预设视点，`cameraId` 从里面挑。 */
  cameras: readonly TwinCamera[]
  /** 模型里全部节点名，视口加载完给的。空数组 = 模型还没加载。 */
  nodeNames: readonly string[]
  /** 视口正处在「点模型拾取节点」模式。 */
  picking: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [TwinHierNode]
  requestPickNode: []
  cancelPick: []
  captureView: [string]
}>()

/** 名字空着退回 id：下拉里一项没有任何标识比显示 id 更糟。 */
function nameOr(node: TwinHierNode): string {
  return node.name === '' ? node.id : node.name
}

const parentOptions = computed(() => [
  { value: '', label: '（顶层）' },
  ...hierParentCandidates(props.nodes, props.modelValue.id).map((item) => ({
    value: item.id,
    label: hierPathOf(props.nodes, item.id).join(' / ') || nameOr(item),
  })),
])

const cameraOptions = computed(() => [
  { value: '', label: '（不切视点）' },
  ...props.cameras.map((item, index) => ({
    value: item.id,
    label: item.name === '' ? `视点 ${index + 1}` : item.name,
  })),
])

const pathText = computed(() =>
  hierPathOf(props.nodes, props.modelValue.id).join(' / '),
)
const childCount = computed(() =>
  hierChildCount(props.nodes, props.modelValue.id),
)
const effectiveCount = computed(
  () => hierEffectiveNodes(props.nodes, props.modelValue.id).length,
)
const viewText = computed(() => viewSummary(props.modelValue.view))

function viewSummary(view: TwinModalView | null): string {
  if (view === null) return ''
  const position = view.position.map((axis) => axis.toFixed(1)).join(', ')
  const target = view.target.map((axis) => axis.toFixed(1)).join(', ')
  return `机位 (${position}) → 注视 (${target})，视野 ${view.fov.toFixed(0)}°`
}

function write(patch: Partial<TwinHierNode>): void {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

function writeParent(next: string): void {
  write({ parentId: next === '' ? null : next })
}

function clearView(): void {
  write({ view: null })
}

function togglePick(): void {
  if (props.picking) emit('cancelPick')
  else emit('requestPickNode')
}
</script>

<template>
  <div class="flex flex-col">
    <InspectorSection title="钻取节点">
      <DtInput
        :model-value="modelValue.name"
        label="名字"
        size="sm"
        @update:model-value="write({ name: $event })"
      />
      <DtField label="图标" hint="从图标表里挑，挑出来的一定画得出来" size="sm">
        <IconPicker
          :model-value="modelValue.icon"
          clear-label="不画图标"
          @update:model-value="write({ icon: $event })"
        />
      </DtField>

      <DtField label="上一层" size="sm">
        <DtSelect
          :model-value="modelValue.parentId ?? ''"
          :options="parentOptions"
          aria-label="上一层"
          size="sm"
          @update:model-value="writeParent"
        />
      </DtField>
      <DtField
        label="同级次序"
        hint="在左栏「层级」页签里拖，或用行上的上下箭头调"
        size="sm"
      >
        <code
          class="block rounded bg-surface-sunken px-2 py-1 text-xs text-text-secondary"
          >{{ modelValue.order }}</code
        >
      </DtField>
    </InspectorSection>

    <InspectorSection title="关联节点">
      <NodePicker
        :model-value="modelValue.nodes"
        :candidates="nodeNames"
        placeholder="节点名"
        empty-hint="模型还没加载，只能按 GLB 里的对象名手填。"
        @update:model-value="write({ nodes: $event })"
      >
        <template #actions>
          <DtButton
            :variant="picking ? 'solid' : 'soft'"
            size="sm"
            icon="magnet"
            block
            @click="togglePick"
          >
            {{ picking ? '点视口里的模型…（取消）' : '从视口拾取' }}
          </DtButton>
        </template>
      </NodePicker>
      <p class="text-xs text-text-disabled">
        留空 = 取全部下级节点的并集（当前
        {{ effectiveCount }} 个）。厂区、车间这种上层本来就没有属于自己的几何。
      </p>
    </InspectorSection>

    <InspectorSection title="进入取景">
      <DtField label="取景快照" size="sm">
        <code
          class="block rounded bg-surface-sunken px-2 py-1 text-xs text-text-secondary"
          >{{ viewText === '' ? '（没配，钻进来不动镜头）' : viewText }}</code
        >
      </DtField>
      <DtButton
        variant="soft"
        size="sm"
        icon="refresh-cw"
        block
        data-test="hier-capture-view"
        @click="emit('captureView', modelValue.id)"
      >
        取当前机位
      </DtButton>
      <DtButton
        v-if="modelValue.view !== null"
        variant="ghost"
        size="sm"
        block
        data-test="hier-clear-view"
        @click="clearView"
      >
        清除取景
      </DtButton>

      <DtField label="或切到预设视点" size="sm">
        <DtSelect
          :model-value="modelValue.cameraId"
          :options="cameraOptions"
          aria-label="或切到预设视点"
          size="sm"
          @update:model-value="write({ cameraId: $event })"
        />
      </DtField>
      <DtNotice
        v-if="modelValue.view !== null && modelValue.cameraId !== ''"
        intent="warning"
        icon="alert-triangle"
      >
        取景快照优先：上面这个预设视点当前不生效。要用它，先清除取景。
      </DtNotice>
    </InspectorSection>

    <InspectorSection title="字段">
      <HierFieldList
        :node="modelValue"
        @update:fields="write({ fields: $event })"
        @update:summary-field-keys="write({ summaryFieldKeys: $event })"
      />
    </InspectorSection>

    <InspectorSection title="钻取页">
      <DtField
        label="标题"
        :hint="pathText === '' ? '留空 = 用钻取路径' : `留空 = ${pathText}`"
        size="sm"
      >
        <DtInput
          :model-value="modelValue.title"
          aria-label="标题"
          size="sm"
          @update:model-value="write({ title: $event })"
        />
      </DtField>
      <DtSwitch
        v-if="childCount > 0"
        :model-value="modelValue.hideChildList"
        label="隐藏子项列表"
        size="sm"
        @update:model-value="write({ hideChildList: $event })"
      />
      <p v-if="childCount > 0" class="text-xs text-text-disabled">
        隐藏之后，这一层只能靠点 3D
        上的部件钻进下一层——那些部件得各自选好「点击打开钻取」。
      </p>
      <p v-else class="text-xs text-text-disabled">
        这是一个叶子层，钻进来直接显示全部字段。
      </p>
    </InspectorSection>
  </div>
</template>
