<script setup lang="ts">
/**
 * @fileoverview 多选同类型时的批量配置：预设条 + 交集字段表单，一改写到全体选中。
 * 控件按注册表派发、零模块特化；交集与混合值判定在 features/dashboard/batchConfig.ts。
 */
import type {
  ConfigPreset,
  DashboardNodePayload,
  ModuleManifest,
} from '@dt/contracts'
import { resolveModuleConfig } from '@dt/runtime'
import { DtButton } from '@dt/ui'
import { computed } from 'vue'

import { batchConfigGroups } from '@/features/dashboard/batchConfig'
import { activePresetIds } from '@/features/dashboard/configForm'
import type { ConfigPath } from '@/features/dashboard/configPath'
import BatchFieldRow from './BatchFieldRow.vue'

const props = defineProps<{
  nodes: readonly DashboardNodePayload[]
  /** 主选中（选中集末位）：混合字段展示它的值。 */
  primary: DashboardNodePayload | null
  manifest: ModuleManifest | undefined
}>()

const emit = defineEmits<{
  config: [path: ConfigPath, value: unknown, isContinuous: boolean]
  preset: [preset: ConfigPreset]
}>()

const presets = computed<readonly ConfigPreset[]>(
  () => props.manifest?.configPresets ?? [],
)

// 「生效中」按主选中的 resolved 判定（无主选中退回首个）：混合选择时亮的是它的状态
const activePresets = computed(() => {
  const base = props.primary ?? props.nodes[0] ?? null
  if (base === null) return new Set<string>()
  return activePresetIds(
    presets.value,
    resolveModuleConfig(props.manifest, base.configJson),
  )
})

const groups = computed(() =>
  batchConfigGroups(props.nodes, props.primary, props.manifest),
)

function forwardConfig(
  path: ConfigPath,
  value: unknown,
  isContinuous: boolean,
): void {
  emit('config', path, value, isContinuous)
}
</script>

<template>
  <div class="dt-batch flex flex-col gap-4">
    <section v-if="presets.length > 0" class="flex flex-wrap gap-1.5">
      <DtButton
        v-for="preset in presets"
        :key="preset.id"
        size="sm"
        :pressed="activePresets.has(preset.id)"
        :title="preset.hint"
        :data-test="`batch-preset-${preset.id}`"
        @click="emit('preset', preset)"
      >
        {{ preset.label }}
      </DtButton>
    </section>

    <section v-for="group in groups" :key="group.title" class="dt-batch__grid">
      <h3 class="dt-batch__heading">{{ group.title }}</h3>
      <BatchFieldRow
        v-for="state in group.fields"
        :key="state.field.key"
        :class="{ 'dt-batch__cell--half': state.field.span === 'half' }"
        :state="state"
        @config="forwardConfig"
      />
    </section>

    <p
      v-if="groups.length === 0 && presets.length === 0"
      class="m-0 text-2xs text-text-disabled"
    >
      这一类模块没有可批量修改的配置项。
    </p>
  </div>
</template>

<style scoped lang="scss">
// 容器查询的量宽基准：右栏可拖宽窄，按面板实际宽度而非视口降级
.dt-batch {
  container-type: inline-size;
}

.dt-batch__heading {
  margin: 0;
  color: var(--text-disabled);
  font-size: 11px;
  letter-spacing: 0.08em;
}

// 分组内两列栅格：与属性面板同口径，span:'half' 的字段占半行
.dt-batch__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 8px;

  > * {
    grid-column: 1 / -1;
  }

  > .dt-batch__cell--half {
    grid-column: auto;
  }
}

// 右栏拖窄时半行字段退回整行，控件不挤爆；不支持容器查询的环境保持两列
@container (max-width: 259px) {
  .dt-batch__grid > .dt-batch__cell--half {
    grid-column: 1 / -1;
  }
}
</style>
