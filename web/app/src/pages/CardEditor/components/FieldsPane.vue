<script setup lang="ts">
/**
 * @fileoverview 右栏：选中那一项的字段表单。**不另写一份表单**——字段仍由
 * `formGroups` + `ConfigFieldControl` 泛型渲染，与属性面板同一条路。
 * ⚠ 选中部件时只摆它那一档的字段：并集里别档的键由 `when: { key: 'kind' }` 滤掉，
 * 这里白拿（MODULE_DATA_CARD_DESIGN §3.1）。
 */
import type { ConfigField } from '@dt/contracts'
import { DtEmpty, DtField, DtHelpTip } from '@dt/ui'
import { computed } from 'vue'

import { formGroups } from '@/features/dashboard/configForm'
import ConfigFieldControl from '@/features/dashboard/controls/ConfigFieldControl.vue'

const props = defineProps<{
  /** 选中那一行的字段声明；没选中给空表。 */
  schema: readonly ConfigField[]
  /** 选中那一行的当前取值。 */
  row: Record<string, unknown>
  title: string
  help: string
}>()

const emit = defineEmits<{ update: [key: string, value: unknown] }>()

const groups = computed(() => formGroups(props.schema, props.row))
</script>

<template>
  <div
    class="ce-fields flex h-full min-h-0 flex-col gap-3 overflow-y-auto pr-1"
  >
    <DtEmpty
      v-if="schema.length === 0"
      icon="settings"
      title="选择配置项"
      hint="请从左侧选择部件或数据格。"
    />
    <template v-else>
      <div class="flex items-center gap-1.5">
        <h3 class="ce-fields__head">{{ title }}</h3>
        <DtHelpTip v-if="help !== ''" :text="help" :label="`${title}说明`" />
      </div>
      <div v-for="group in groups" :key="group.title" class="ce-fields__grid">
        <DtField
          v-for="field in group.fields"
          :key="field.key"
          :class="{ 'ce-fields__cell--half': field.span === 'half' }"
          :label="field.label"
          :help="field.help"
          size="sm"
        >
          <ConfigFieldControl
            :field="field"
            :value="row[field.key]"
            :depth="0"
            @update="(value: unknown) => emit('update', field.key, value)"
          />
        </DtField>
      </div>
    </template>
  </div>
</template>

<style scoped lang="scss">
.ce-fields {
  container-type: inline-size;
}

.ce-fields__head {
  margin: 0;
  color: var(--text-disabled);
  font-size: 11px;
  letter-spacing: 0.06em;
}

.ce-fields__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 8px;
}

.ce-fields__grid > :not(.ce-fields__cell--half) {
  grid-column: 1 / -1;
}

@container (max-width: 320px) {
  .ce-fields__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
