<script setup lang="ts">
/**
 * @fileoverview 右栏「专属配置」页：由 `configSchema` **泛型渲染**出来的表单，
 * 外加清单声明的外观预设。
 * ⚠ 这里没有一行针对某个具体模块的表单代码——控件按 `ConfigField.type` 查注册表，
 * 分组与条件显示按清单声明走，新增模块自动获得完整属性面板（DASHBOARD_DESIGN §5.2）。
 * 几何、显隐、卡片外观是每个模块都有的，归「通用配置」页，不在这里。
 */
import type {
  ConfigField,
  ConfigPreset,
  DashboardNodePayload,
  ModuleManifest,
} from '@dt/contracts'
import { resolveModuleConfig } from '@dt/runtime'
import { DtEmpty, DtField } from '@dt/ui'
import { computed } from 'vue'

import type { ConfigPath } from '@/features/dashboard/configPath'
import { formGroups } from '@/features/dashboard/configForm'
import ConfigFieldControl from '@/features/dashboard/controls/ConfigFieldControl.vue'
import SubEditorEntry from './SubEditorEntry.vue'

const props = defineProps<{
  node: DashboardNodePayload
  manifest: ModuleManifest | undefined
}>()

const emit = defineEmits<{
  config: [path: ConfigPath, value: unknown, isContinuous: boolean]
  preset: [preset: ConfigPreset]
}>()

const resolved = computed<Record<string, unknown>>(() =>
  resolveModuleConfig(props.manifest, props.node.configJson),
)

const groups = computed(() =>
  formGroups(props.manifest?.configSchema ?? [], resolved.value),
)

const presets = computed<readonly ConfigPreset[]>(
  () => props.manifest?.configPresets ?? [],
)

// 声明了子编辑器的那个字段不画通用控件，改画入口；其余字段照旧
const subEditor = computed(() => props.manifest?.subEditor ?? null)

function writeField(field: ConfigField, value: unknown, live: boolean): void {
  emit('config', [field.key], value, live)
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1">
    <DtEmpty
      v-if="groups.length === 0 && presets.length === 0"
      icon="settings"
      title="这个模块没有专属配置"
      hint="它的外观在「通用」页里调"
    />

    <template v-else>
      <!-- 预设排在最上面：先定基调、再逐项微调，下面每一项都是在它的结果上做局部覆盖 -->
      <section v-if="presets.length > 0" class="flex flex-wrap gap-1.5">
        <button
          v-for="preset in presets"
          :key="preset.id"
          type="button"
          class="dt-prop__preset"
          :title="preset.hint"
          @click="emit('preset', preset)"
        >
          {{ preset.label }}
        </button>
      </section>

      <section
        v-for="group in groups"
        :key="group.title"
        class="flex flex-col gap-3"
      >
        <h3 class="dt-prop__heading">{{ group.title }}</h3>
        <DtField
          v-for="field in group.fields"
          :key="field.key"
          :label="field.label"
          :hint="field.help"
          size="sm"
        >
          <SubEditorEntry
            v-if="subEditor !== null && subEditor.configKey === field.key"
            :sub-editor="subEditor"
            :value="resolved[field.key]"
          />
          <ConfigFieldControl
            v-else
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

<style scoped lang="scss">
.dt-prop__heading {
  margin: 0;
  color: var(--text-disabled);
  font-size: 11px;
  letter-spacing: 0.08em;
}

.dt-prop__preset {
  padding: 3px 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-pill);
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  transition:
    color 0.15s ease,
    border-color 0.15s ease;

  &:hover {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
  }
}
</style>
