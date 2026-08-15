<script setup lang="ts">
/**
 * @fileoverview 部件检查器：名字、关联的模型节点、显隐规则与点击距离门禁。
 *
 * ⚠ `nodes` 是模型文件里的对象名，本包看不见模型：模型里改了名字，这个部件就
 * 静默地什么都不再命中。所以拿得到节点清单时必须把对不上的那几条标出来。
 * ⚠ 点击距离的三条阈值各自带参考系，脱离参考系的裸数字不可类比。
 */
import type {
  TwinClickDistanceRule,
  TwinDistanceRule,
  TwinPart,
  TwinVisibilityRule,
} from '@dt/twin-config'
import { DtButton, DtField, DtInput } from '@dt/ui'

import DistanceField from '../fields/DistanceField.vue'
import InspectorSection from '../fields/InspectorSection.vue'
import NodePicker from '../fields/NodePicker.vue'
import VisibilityFields from '../fields/VisibilityFields.vue'

const props = defineProps<{
  modelValue: TwinPart
  /** 模型里全部节点名，视口加载完给的。空数组 = 模型还没加载。 */
  nodeNames: readonly string[]
  /** 视口正处在「点模型拾取节点」模式。 */
  picking: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [TwinPart]
  requestPickNode: []
  cancelPick: []
}>()

function write(patch: Partial<TwinPart>): void {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

function writeClick(patch: Partial<TwinClickDistanceRule>): void {
  write({ clickDistance: { ...props.modelValue.clickDistance, ...patch } })
}

function writeVisibility(visibility: TwinVisibilityRule): void {
  write({ visibility })
}

function writeMin(min: TwinDistanceRule | null): void {
  writeClick({ min })
}

function writeMax(max: TwinDistanceRule | null): void {
  writeClick({ max })
}

function writeFarThreshold(farThreshold: TwinDistanceRule | null): void {
  writeClick({ farThreshold })
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
      <DtField label="部件 id" size="sm" hint="点这个部件时联动规则收到的值就是它。">
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
    </InspectorSection>

    <InspectorSection title="显隐">
      <VisibilityFields
        :model-value="modelValue.visibility"
        @update:model-value="writeVisibility"
      />
    </InspectorSection>

    <InspectorSection title="点击距离">
      <DistanceField
        :model-value="modelValue.clickDistance.min"
        label="近于此距离不响应"
        :fallback="1"
        @update:model-value="writeMin"
      />
      <DistanceField
        :model-value="modelValue.clickDistance.max"
        label="远于此距离不响应"
        :fallback="80"
        @update:model-value="writeMax"
      />
      <DistanceField
        :model-value="modelValue.clickDistance.farThreshold"
        label="两段式点击分界"
        :fallback="30"
        @update:model-value="writeFarThreshold"
      />
      <p class="text-xs text-text-disabled">
        远于「两段式点击分界」时，第一次点击只是把镜头拉近，再点一次才是真的点击。
      </p>
      <p class="text-xs text-text-disabled">
        阈值 ≤ 0 或距离取不到时一律按「不限制」走，不误杀点击。
      </p>
    </InspectorSection>
  </div>
</template>
