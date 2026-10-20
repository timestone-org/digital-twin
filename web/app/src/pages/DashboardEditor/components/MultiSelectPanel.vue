<script setup lang="ts">
/**
 * @fileoverview 多选态的右栏：已选清单、同类型批量配置、批量动作
 * （对齐 / 分布 / 显隐 / 统一尺寸）与批量删除。
 * ⚠ 对齐与分布只在**同一层级**的选中集上成立（跨容器坐标系不同），
 * 能不能用由页面算好后经 alignReady / distributeReady 传进来。
 * ⚠ 模板属性里只放函数名，不写多行箭头——嵌套闸的正则会把模板里的 `=>` 算进层数。
 */
import type { ConfigPreset, DashboardNodePayload } from '@dt/contracts'
import type { GetModuleManifest } from '@dt/runtime'
import { DtButton, DtIconButton } from '@dt/ui'
import type { IconName } from '@dt/ui'
import { computed } from 'vue'

import {
  isUniformType,
  moduleTypeGroups,
} from '@/features/dashboard/batchConfig'
import type { AlignKind } from '@/features/dashboard/canvasAlign'
import type { ConfigPath } from '@/features/dashboard/configPath'
import type { SizeMatchMode } from '../scripts/editorArrange'
import BatchConfigForm from './BatchConfigForm.vue'

const props = defineProps<{
  selectedNodes: readonly DashboardNodePayload[]
  /** 主选中 = 选中集末位：混合字段的展示值与统一尺寸的基准都是它。 */
  primary: DashboardNodePayload | null
  getManifest: GetModuleManifest
  alignReady: boolean
  distributeReady: boolean
}>()

const emit = defineEmits<{
  align: [kind: AlignKind]
  distribute: [axis: 'x' | 'y']
  'remove-all': []
  config: [path: ConfigPath, value: unknown, isContinuous: boolean]
  preset: [preset: ConfigPreset]
  'select-type': [ids: readonly string[]]
  'visible-batch': [isVisible: boolean]
  'size-batch': [mode: SizeMatchMode]
}>()

const ALIGN_ACTIONS: readonly {
  kind: AlignKind
  label: string
  icon: IconName
}[] = [
  { kind: 'left', label: '左对齐', icon: 'align-left' },
  { kind: 'hcenter', label: '水平居中', icon: 'align-center-horizontal' },
  { kind: 'right', label: '右对齐', icon: 'align-right' },
  { kind: 'top', label: '顶对齐', icon: 'align-top' },
  { kind: 'vcenter', label: '垂直居中', icon: 'align-center-vertical' },
  { kind: 'bottom', label: '底对齐', icon: 'align-bottom' },
]

const DISTRIBUTE_ACTIONS: readonly {
  axis: 'x' | 'y'
  label: string
  icon: IconName
}[] = [
  { axis: 'x', label: '水平等间距', icon: 'distribute-horizontal' },
  { axis: 'y', label: '垂直等间距', icon: 'distribute-vertical' },
]

const VISIBLE_ACTIONS: readonly {
  isVisible: boolean
  label: string
  icon: IconName
}[] = [
  { isVisible: true, label: '全部显示', icon: 'eye' },
  { isVisible: false, label: '全部隐藏', icon: 'eye-off' },
]

const SIZE_ACTIONS: readonly { mode: SizeMatchMode; label: string }[] = [
  { mode: 'width', label: '等宽' },
  { mode: 'height', label: '等高' },
  { mode: 'both', label: '等尺寸' },
]

const typeGroups = computed(() =>
  moduleTypeGroups(props.selectedNodes, props.getManifest),
)

const isUniform = computed(() => isUniformType(props.selectedNodes))

const manifest = computed(() => {
  const first = props.selectedNodes[0]
  return first === undefined ? undefined : props.getManifest(first.moduleType)
})

function forwardConfig(
  path: ConfigPath,
  value: unknown,
  isContinuous: boolean,
): void {
  emit('config', path, value, isContinuous)
}

function forwardPreset(preset: ConfigPreset): void {
  emit('preset', preset)
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
    <p class="m-0 text-sm text-text-primary" data-test="multi-count">
      已选 {{ selectedNodes.length }} 个节点
    </p>

    <section>
      <h3 class="m-0 mb-2 text-2xs tracking-wide text-text-disabled">
        已选清单
      </h3>
      <ul class="m-0 flex list-none flex-col gap-1 p-0">
        <li
          v-for="group in typeGroups"
          :key="group.moduleType"
          class="flex items-center justify-between gap-2 text-xs text-text-secondary"
          :data-test="`multi-type-${group.moduleType}`"
        >
          <span>{{ group.count }} × {{ group.displayName }}</span>
          <DtButton
            v-if="typeGroups.length > 1"
            size="sm"
            variant="ghost"
            intent="neutral"
            :data-test="`multi-select-type-${group.moduleType}`"
            @click="emit('select-type', group.ids)"
          >
            只选这一类
          </DtButton>
        </li>
      </ul>
    </section>

    <BatchConfigForm
      v-if="isUniform"
      :nodes="selectedNodes"
      :primary="primary"
      :manifest="manifest"
      @config="forwardConfig"
      @preset="forwardPreset"
    />

    <section>
      <h3 class="m-0 mb-2 text-2xs tracking-wide text-text-disabled">对齐</h3>
      <div class="flex flex-wrap gap-1.5">
        <DtIconButton
          v-for="item in ALIGN_ACTIONS"
          :key="item.kind"
          size="sm"
          variant="outline"
          :label="item.label"
          :tooltip="
            alignReady ? item.label : `${item.label}：需同层级 ≥2 个节点`
          "
          :data-test="`multi-align-${item.kind}`"
          :disabled="!alignReady"
          :icon="item.icon"
          @click="emit('align', item.kind)"
        />
      </div>
    </section>

    <section>
      <h3 class="m-0 mb-2 text-2xs tracking-wide text-text-disabled">分布</h3>
      <div class="flex flex-wrap gap-1.5">
        <DtIconButton
          v-for="item in DISTRIBUTE_ACTIONS"
          :key="item.axis"
          size="sm"
          variant="outline"
          :label="item.label"
          :tooltip="
            distributeReady ? item.label : `${item.label}：需同层级 ≥3 个节点`
          "
          :data-test="`multi-distribute-${item.axis}`"
          :disabled="!distributeReady"
          :icon="item.icon"
          @click="emit('distribute', item.axis)"
        />
      </div>
    </section>

    <section>
      <h3 class="m-0 mb-2 text-2xs tracking-wide text-text-disabled">
        初始显隐
      </h3>
      <div class="flex flex-wrap gap-1.5">
        <DtIconButton
          v-for="item in VISIBLE_ACTIONS"
          :key="item.label"
          size="sm"
          variant="outline"
          :data-test="`multi-visible-${item.isVisible ? 'on' : 'off'}`"
          :label="item.label"
          :icon="item.icon"
          @click="emit('visible-batch', item.isVisible)"
        />
      </div>
    </section>

    <section>
      <h3 class="m-0 mb-2 text-2xs tracking-wide text-text-disabled">
        统一尺寸
      </h3>
      <div class="grid grid-cols-3 gap-1">
        <DtButton
          v-for="item in SIZE_ACTIONS"
          :key="item.mode"
          size="sm"
          variant="outline"
          :title="`${item.label}：以最后选中的节点为基准，只改宽高不动位置`"
          :data-test="`multi-size-${item.mode}`"
          @click="emit('size-batch', item.mode)"
        >
          {{ item.label }}
        </DtButton>
      </div>
    </section>

    <DtButton
      size="sm"
      variant="soft"
      intent="danger"
      icon="trash"
      block
      data-test="multi-remove"
      @click="emit('remove-all')"
    >
      删除所选
    </DtButton>
  </div>
</template>
