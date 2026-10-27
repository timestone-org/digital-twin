<script setup lang="ts">
/** @fileoverview 按用途挑选设计模板并预览配置说明。 */
import { DtButton, DtCard, DtEmpty, DtInput, DtSegmented, DtTag } from '@dt/ui'
import { computed, ref } from 'vue'
import { PIPELINE_TEMPLATES } from '../scripts/templates'
import { ENERGY_RULE_TEMPLATES } from '../scripts/ruleTemplates'

const selectedKey = defineModel<string>({ required: true })
defineProps<{ disabled: boolean }>()
const keyword = ref('')
const category = ref('all')
const categories = [
  { value: 'all', label: '全部' },
  { value: 'prediction', label: '预测与分类' },
  { value: 'detection', label: '异常检测' },
  { value: 'rule', label: '规则计算' },
]
function categoryOf(key: string): string {
  if (key === 'device_anomaly') return 'detection'
  if (ENERGY_RULE_TEMPLATES.some((item) => item.key === key)) return 'rule'
  return 'prediction'
}
const orderedTemplates = [
  ...PIPELINE_TEMPLATES.filter((item) => item.key === 'regression'),
  ...PIPELINE_TEMPLATES.filter(
    (item) => item.key !== 'regression' && item.key !== 'blank',
  ),
  ...PIPELINE_TEMPLATES.filter((item) => item.key === 'blank'),
]
const visible = computed(() =>
  orderedTemplates.filter(
    (item) =>
      (category.value === 'all' ||
        (item.key !== 'blank' && categoryOf(item.key) === category.value)) &&
      `${item.label} ${item.hint}`
        .toLowerCase()
        .includes(keyword.value.trim().toLowerCase()),
  ),
)
const selected = computed(() =>
  PIPELINE_TEMPLATES.find((item) => item.key === selectedKey.value),
)
const graph = computed(() => selected.value?.build())
</script>

<template>
  <section class="template-picker" aria-label="选择设计模板">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-section font-semibold">选择设计模板</h2>
      <DtSegmented
        v-model="category"
        :options="categories"
        aria-label="模板用途"
      />
    </div>
    <div class="template-picker__body">
      <div class="template-picker__catalog">
        <DtInput
          v-model="keyword"
          type="search"
          size="sm"
          placeholder="搜索用途，例如能耗、负荷"
          aria-label="搜索设计模板"
        />
        <div
          class="template-picker__options"
          role="group"
          aria-label="设计模板目录"
        >
          <DtButton
            v-for="item in visible"
            :key="item.key"
            class="template-picker__option"
            size="sm"
            :pressed="selectedKey === item.key"
            :disabled="disabled"
            :title="item.label"
            @click="selectedKey = item.key"
          >
            {{ item.label }}
          </DtButton>
          <DtEmpty
            v-if="visible.length === 0"
            inline
            title="没有匹配的设计模板"
            hint="试试其他关键词或切换到全部。"
          />
        </div>
      </div>
      <DtCard
        v-if="selected"
        class="template-picker__preview"
        :title="selected.label"
        icon="workflow"
      >
        <div class="mb-4 flex flex-wrap gap-2">
          <DtTag intent="primary">{{
            selected.key === 'blank' ? '自由设计' : '设计模板'
          }}</DtTag>
          <DtTag>{{ graph?.nodes.length }} 个算子</DtTag>
          <DtTag>{{ graph?.edges.length }} 条连线</DtTag>
        </div>
        <p class="leading-relaxed text-text-secondary">{{ selected.hint }}</p>
        <template #footer
          >创建后进入流程图，配置实际数据和参数，再运行查看结果。</template
        >
      </DtCard>
    </div>
  </section>
</template>

<style scoped lang="scss">
.template-picker {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  &__body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
    gap: 1rem;
  }
  &__catalog {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
  }
  &__options {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    height: 15rem;
    overflow-y: auto;
    padding: 0.25rem;
  }
  &__option {
    flex-shrink: 0;
    justify-content: flex-start;
  }
  &__preview {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  @media (width < 48rem) {
    &__body {
      grid-template-columns: minmax(0, 1fr);
    }
  }
}
</style>
