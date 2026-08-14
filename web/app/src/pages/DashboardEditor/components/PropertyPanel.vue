<script setup lang="ts">
/**
 * @fileoverview 属性面板：几何 + 由 `configSchema` **泛型渲染**出来的表单。
 * ⚠ 这里没有一行针对某个具体模块的表单代码——控件按 `ConfigField.type` 查注册表，
 * 分组与条件显示按清单声明走，新增模块自动获得完整属性面板（DASHBOARD_DESIGN §5.2）。
 */
import type {
  ConfigField,
  DashboardNodePayload,
  ModuleManifest,
} from '@dt/contracts'
import { resolveModuleConfig } from '@dt/runtime'
import { DtEmpty, DtField, DtNumberInput, DtSwitch } from '@dt/ui'
import { computed } from 'vue'

import type { ConfigPath } from '@/features/dashboard/configPath'
import { formGroups } from '@/features/dashboard/configForm'
import type { NodeGeometry } from '@/features/dashboard/editorDoc'
import ConfigFieldControl from '@/features/dashboard/controls/ConfigFieldControl.vue'

const props = defineProps<{
  node: DashboardNodePayload | null
  manifest: ModuleManifest | undefined
}>()

const emit = defineEmits<{
  config: [path: ConfigPath, value: unknown, isContinuous: boolean]
  geometry: [geometry: NodeGeometry, isContinuous: boolean]
  visible: [isVisible: boolean]
}>()

/** 几何四项：键就是 `DashboardNodePayload` 上的字段名，模板里不再各写一遍。 */
const GEOMETRY_FIELDS: readonly { key: keyof NodeGeometry; label: string }[] = [
  { key: 'x', label: 'X (px)' },
  { key: 'y', label: 'Y (px)' },
  { key: 'w', label: '宽 (px)' },
  { key: 'h', label: '高 (px)' },
]

const resolved = computed<Record<string, unknown>>(() =>
  props.node === null
    ? {}
    : resolveModuleConfig(props.manifest, props.node.configJson),
)

const groups = computed(() =>
  formGroups(props.manifest?.configSchema ?? [], resolved.value),
)

function geometryOf(node: DashboardNodePayload): NodeGeometry {
  return { x: node.x, y: node.y, w: node.w, h: node.h }
}

function writeGeometry(
  key: keyof NodeGeometry,
  next: number | undefined,
): void {
  const node = props.node
  if (node === null || next === undefined) return
  emit('geometry', { ...geometryOf(node), [key]: next }, true)
}

function writeField(field: ConfigField, value: unknown, live: boolean): void {
  emit('config', [field.key], value, live)
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-4 overflow-y-auto">
    <DtEmpty
      v-if="!node"
      icon="layout-grid"
      title="没有选中节点"
      hint="在画布或图层树上点一个节点"
    />
    <template v-else>
      <section class="grid grid-cols-2 gap-2">
        <DtField
          v-for="item in GEOMETRY_FIELDS"
          :key="item.key"
          :label="item.label"
          size="sm"
        >
          <DtNumberInput
            :model-value="geometryOf(node)[item.key]"
            size="sm"
            @update:model-value="writeGeometry(item.key, $event)"
          />
        </DtField>
      </section>

      <DtField label="初始可见" size="sm">
        <DtSwitch
          :model-value="node.isVisible"
          size="sm"
          aria-label="初始可见"
          @update:model-value="emit('visible', $event)"
        />
      </DtField>

      <section
        v-for="group in groups"
        :key="group.title"
        class="flex flex-col gap-3"
      >
        <h3 class="m-0 text-2xs tracking-wide text-text-disabled">
          {{ group.title }}
        </h3>
        <DtField
          v-for="field in group.fields"
          :key="field.key"
          :label="field.label"
          :hint="field.help"
          size="sm"
        >
          <ConfigFieldControl
            :field="field"
            :value="resolved[field.key]"
            :depth="0"
            @update="
              (value: unknown, live: boolean) => writeField(field, value, live)
            "
          />
        </DtField>
      </section>
    </template>
  </div>
</template>
