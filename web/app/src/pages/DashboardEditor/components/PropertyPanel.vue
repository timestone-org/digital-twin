<script setup lang="ts">
/**
 * @fileoverview 右栏「专属配置」页：由 `configSchema` **泛型渲染**出来的表单，
 * 外加清单声明的外观预设。
 * ⚠ 这里没有一行针对某个具体模块的表单代码——控件按 `ConfigField.type` 查注册表，
 * 分组与条件显示按清单声明走，新增模块自动获得完整属性面板（DASHBOARD_DESIGN §5.2）。
 * 几何、显隐、卡片外观是每个模块都有的，归「通用配置」页，不在这里。
 *
 * 预设墙分两排：清单自带的，与**用户存下来的**那些（卡片样式库）。后者带着外壳
 * 一起落，故合成一条 `ConfigPreset` 交给同一条应用路径——顶层浅合并正好把
 * `__cardStyle` 整袋换掉，与「一套样式就是整个外壳」的语义对上。
 */
import type {
  ConfigField,
  ConfigPreset,
  DashboardNodePayload,
  ModuleManifest,
} from '@dt/contracts'
import { resolveModuleConfig } from '@dt/runtime'
import { DtButton, DtEmpty, DtField } from '@dt/ui'
import { computed } from 'vue'

import type { ConfigPath } from '@/features/dashboard/configPath'
import {
  stylesForModule,
  useCardStyles,
} from '@/features/dashboard/cardStyleLibrary'
import { activePresetIds, formGroups } from '@/features/dashboard/configForm'
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

// 子集匹配：预设写过的键全部与当前 resolved 值相等就点亮，多个同亮是正常的
const activePresets = computed(() =>
  activePresetIds(presets.value, resolved.value),
)

const readStyles = useCardStyles()

/**
 * 用户存下来、且**绑了这个模块类型**的样式，合成预设交给同一条应用路径。
 * ⚠ 通用外壳样式不列在这里：它们没有内芯，归「通用」页那个外观风格下拉。
 *   两处都列的话，同一条样式在右栏出现两次，而点哪一个结果还不一样。
 */
const savedPresets = computed<ConfigPreset[]>(() =>
  stylesForModule(readStyles(), props.manifest?.type ?? null)
    .filter((one) => one.moduleType !== null)
    .map((one) => ({
      id: `saved:${one.id}`,
      label: one.name,
      hint: one.description ?? '我存下来的样式',
      config: { ...one.config, __cardStyle: one.chrome },
    })),
)

const activeSaved = computed(() =>
  activePresetIds(savedPresets.value, resolved.value),
)

// 声明了子编辑器的那个字段不画通用控件，改画入口；其余字段照旧
const subEditor = computed(() => props.manifest?.subEditor ?? null)

function writeField(field: ConfigField, value: unknown, live: boolean): void {
  emit('config', [field.key], value, live)
}
</script>

<template>
  <div class="dt-prop flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1">
    <DtEmpty
      v-if="
        groups.length === 0 && presets.length === 0 && savedPresets.length === 0
      "
      icon="settings"
      title="这个模块没有专属配置"
      hint="它的外观在「通用」页里调"
    />

    <template v-else>
      <!-- 预设排在最上面：先定基调、再逐项微调，下面每一项都是在它的结果上做局部覆盖 -->
      <section v-if="presets.length > 0" class="flex flex-wrap gap-1.5">
        <DtButton
          v-for="preset in presets"
          :key="preset.id"
          size="sm"
          :pressed="activePresets.has(preset.id)"
          :title="preset.hint"
          @click="emit('preset', preset)"
        >
          {{ preset.label }}
        </DtButton>
      </section>

      <!-- 我存下来的：带着外壳一起落，故与上面那排分开摆，免得看着像同一类 -->
      <section v-if="savedPresets.length > 0" class="flex flex-col gap-1.5">
        <h3 class="dt-prop__heading">我的样式</h3>
        <div class="flex flex-wrap gap-1.5">
          <DtButton
            v-for="preset in savedPresets"
            :key="preset.id"
            size="sm"
            icon="palette"
            :pressed="activeSaved.has(preset.id)"
            :title="preset.hint"
            @click="emit('preset', preset)"
          >
            {{ preset.label }}
          </DtButton>
        </div>
      </section>

      <section v-for="group in groups" :key="group.title" class="dt-prop__grid">
        <h3 class="dt-prop__heading">{{ group.title }}</h3>
        <DtField
          v-for="field in group.fields"
          :key="field.key"
          :class="{ 'dt-prop__cell--half': field.span === 'half' }"
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
// 容器查询的量宽基准：右栏可拖宽窄，按面板实际宽度而非视口降级
.dt-prop {
  container-type: inline-size;
}

.dt-prop__heading {
  margin: 0;
  color: var(--text-disabled);
  font-size: 11px;
  letter-spacing: 0.08em;
}

// 分组内两列栅格：字段缺省占整行，清单声明 span:'half' 的占半行
.dt-prop__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 8px;

  > * {
    grid-column: 1 / -1;
  }

  > .dt-prop__cell--half {
    grid-column: auto;
  }
}

// 右栏拖窄时半行字段退回整行，控件不挤爆；不支持容器查询的环境保持两列
@container (max-width: 259px) {
  .dt-prop__grid > .dt-prop__cell--half {
    grid-column: 1 / -1;
  }
}
</style>
