<script setup lang="ts">
/**
 * @fileoverview 右栏：一条样式的两段表单。**外壳**直接复用编辑器右栏那套字段组，
 * **内芯**由该模块的 `configSchema` 泛型渲染——两处都不另写一份，抄一份必漂成
 * 「一边能配、另一边配了不生效」。
 *
 * ⚠ 内芯只摆观感字段：内容字段（标题、行列表、缺值占位、阈值规则）是**滤掉**
 * 不是禁用——一个存不进样式的输入框摆在那儿，用户改了、存了、套用时发现没生效，
 * 只会以为这一页坏了（CARD_STYLE_LIBRARY_DESIGN §3.4）。
 */
import type { CardChrome, ConfigField, ModuleManifest } from '@dt/contracts'
import { DtField, DtInput } from '@dt/ui'
import { computed } from 'vue'

import CardStyleFields from '@/components/chrome/CardStyleFields.vue'
import { formGroups } from '@/features/dashboard/configForm'
import ConfigFieldControl from '@/features/dashboard/controls/ConfigFieldControl.vue'
import { styleFields } from '../scripts/styleDraft'

const props = defineProps<{
  name: string
  description: string
  chrome: CardChrome
  config: Record<string, unknown>
  /** 草稿绑的模块清单；null = 通用外壳样式，不摆内芯段。 */
  manifest: ModuleManifest | null
}>()

const emit = defineEmits<{
  'update:name': [value: string]
  'update:description': [value: string]
  'update:chrome': [value: CardChrome]
  config: [key: string, value: unknown]
}>()

const groups = computed(() =>
  formGroups(styleFields(props.manifest), props.config),
)

function writeField(field: ConfigField, value: unknown): void {
  emit('config', field.key, value)
}
</script>

<template>
  <div
    class="dt-style-form flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1"
  >
    <section class="flex flex-col gap-2">
      <DtInput
        :model-value="name"
        label="样式名称"
        size="sm"
        required
        @update:model-value="emit('update:name', $event)"
      />
      <DtInput
        :model-value="description"
        label="一句话说明"
        size="sm"
        @update:model-value="emit('update:description', $event)"
      />
    </section>

    <section class="flex flex-col gap-2">
      <h3 class="dt-style-form__heading">外壳</h3>
      <CardStyleFields
        :model-value="chrome"
        @update:model-value="emit('update:chrome', $event)"
      />
    </section>

    <section v-if="manifest !== null" class="flex flex-col gap-2">
      <h3 class="dt-style-form__heading">内芯 · {{ manifest.displayName }}</h3>
      <div
        v-for="group in groups"
        :key="group.title"
        class="dt-style-form__grid"
      >
        <h4 class="dt-style-form__heading">{{ group.title }}</h4>
        <DtField
          v-for="field in group.fields"
          :key="field.key"
          :class="{ 'dt-style-form__cell--half': field.span === 'half' }"
          :label="field.label"
          :hint="field.help"
          size="sm"
        >
          <ConfigFieldControl
            :field="field"
            :value="config[field.key]"
            :depth="0"
            @update="(value: unknown) => writeField(field, value)"
          />
        </DtField>
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
// 容器查询的量宽基准：右栏可拖宽窄，按面板实际宽度而非视口降级
.dt-style-form {
  container-type: inline-size;
}

.dt-style-form__heading {
  margin: 0;
  color: var(--text-disabled);
  font-size: 11px;
  letter-spacing: 0.08em;
}

.dt-style-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 8px;
}

.dt-style-form__grid > :not(.dt-style-form__cell--half) {
  grid-column: 1 / -1;
}

@container (max-width: 320px) {
  .dt-style-form__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
