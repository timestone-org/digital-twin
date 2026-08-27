<script setup lang="ts">
/**
 * @fileoverview 部件检查器：名字、关联的模型节点、外观、状态染色、显隐，
 * 以及远近两档的点击动作与近距弹出的详情卡片。
 *
 * ⚠ `nodes` 是模型文件里的对象名，本包看不见模型：模型里改了名字，这个部件就
 * 静默地什么都不再命中。所以拿得到节点清单时必须把对不上的那几条标出来。
 * ⚠ 部件占**两个绑定槽**：状态染色一行，详情字段每个字段一行，行号各数各的。
 */
import type {
  TwinCamera,
  TwinClickDistanceRule,
  TwinPart,
  TwinPartClick,
  TwinPartDetail,
  TwinPartLook,
  TwinPartTint,
  TwinVisibilityRule,
} from '@dt/twin-config'
import { DtButton, DtField, DtInput } from '@dt/ui'

import InspectorSection from '../fields/InspectorSection.vue'
import NodePicker from '../fields/NodePicker.vue'
import PartClickFields from '../fields/PartClickFields.vue'
import PartDetailFields from '../fields/PartDetailFields.vue'
import PartLookFields from '../fields/PartLookFields.vue'
import PartTintFields from '../fields/PartTintFields.vue'
import VisibilityFields from '../fields/VisibilityFields.vue'

const props = defineProps<{
  modelValue: TwinPart
  /** 模型里全部节点名，视口加载完给的。空数组 = 模型还没加载。 */
  nodeNames: readonly string[]
  /** 预设视点，远距取景可以挑一个。 */
  cameras: readonly TwinCamera[]
  /** 本部件之前已有多少行摊平的详情字段。 */
  fieldRowOffset: number
  /** 视口正处在「点模型拾取节点」模式。 */
  picking: boolean
  /** 这个部件在绑定页上已经挑好点位了吗；染色面板据它提醒。 */
  tintBound: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [TwinPart]
  requestPickNode: []
  cancelPick: []
  captureView: []
}>()

function write(patch: Partial<TwinPart>): void {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

function writeVisibility(visibility: TwinVisibilityRule): void {
  write({ visibility })
}

function writeLook(look: TwinPartLook): void {
  write({ look })
}

function writeTint(tint: TwinPartTint | null): void {
  write({ tint })
}

function writeClick(click: TwinPartClick): void {
  write({ click })
}

function writeClickDistance(clickDistance: TwinClickDistanceRule): void {
  write({ clickDistance })
}

function writeDetail(detail: TwinPartDetail): void {
  write({ detail })
}

function togglePick(): void {
  if (props.picking) emit('cancelPick')
  else emit('requestPickNode')
}
</script>

<template>
  <div class="flex flex-col">
    <InspectorSection title="部件">
      <DtInput
        :model-value="modelValue.name"
        label="名字"
        size="sm"
        @update:model-value="write({ name: $event })"
      />
      <DtField
        label="部件 id"
        size="sm"
        hint="点这个部件时联动规则收到的值就是它。"
      >
        <code
          class="block truncate rounded bg-surface-sunken px-2 py-1 text-xs text-text-secondary"
          >{{ modelValue.id }}</code
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
            :pressed="picking"
            size="sm"
            icon="magnet"
            block
            @click="togglePick"
          >
            {{ picking ? '点视口里的模型…（取消）' : '从视口拾取' }}
          </DtButton>
          <p class="text-xs text-text-disabled">
            选中当前部件后，按住 Shift 可在视口连续点选或框选节点。
          </p>
        </template>
      </NodePicker>
    </InspectorSection>

    <InspectorSection title="外观">
      <PartLookFields
        :model-value="modelValue.look"
        @update:model-value="writeLook"
      />
    </InspectorSection>

    <InspectorSection title="状态染色">
      <PartTintFields
        :model-value="modelValue.tint"
        :bound="tintBound"
        @update:model-value="writeTint"
      />
    </InspectorSection>

    <InspectorSection title="显隐">
      <VisibilityFields
        :model-value="modelValue.visibility"
        @update:model-value="writeVisibility"
      />
    </InspectorSection>

    <InspectorSection title="点击">
      <PartClickFields
        :model-value="modelValue.click"
        :distance="modelValue.clickDistance"
        :cameras="cameras"
        @update:model-value="writeClick"
        @update:distance="writeClickDistance"
        @capture-view="emit('captureView')"
      />
    </InspectorSection>

    <InspectorSection title="详情卡片">
      <PartDetailFields
        :part="modelValue"
        :row-offset="fieldRowOffset"
        @update:model-value="writeDetail"
      />
    </InspectorSection>
  </div>
</template>
