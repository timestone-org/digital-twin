<script setup lang="ts">
/** @fileoverview 按用途挑选设计模板并预览配置说明。 */
import {
  DtButton,
  DtCard,
  DtEmpty,
  DtInput,
  DtNotice,
  DtPagination,
  DtSegmented,
  DtSpinner,
  DtTag,
} from '@dt/ui'
import { computed, onMounted, ref, watch } from 'vue'
import { listBuiltinTemplates } from '@/api/modelingTemplates'
import { useAsyncList } from '@/composables/useAsyncList'
import { PIPELINE_TEMPLATES } from '../scripts/templates'

const selectedKey = defineModel<string>({ required: true })
const props = defineProps<{ disabled: boolean }>()
type Category = NonNullable<
  Parameters<typeof listBuiltinTemplates>[0]['category']
>
const keyword = ref('')
const appliedKeyword = ref('')
const category = ref<Category>('all')
const categories = [
  { value: 'all', label: '全部' },
  { value: 'prediction', label: '预测与分类' },
  { value: 'detection', label: '异常检测' },
  { value: 'analysis', label: '探索分析' },
  { value: 'rule', label: '规则计算' },
]
const list = useAsyncList((query, signal) =>
  listBuiltinTemplates(
    { ...query, q: appliedKeyword.value, category: category.value },
    signal,
  ),
)
async function search(): Promise<void> {
  if (props.disabled) return
  appliedKeyword.value = keyword.value.trim()
  await list.reloadFromFirstPage()
}
function setCategory(value: string): void {
  if (props.disabled) return
  if (
    value === 'all' ||
    value === 'prediction' ||
    value === 'detection' ||
    value === 'analysis' ||
    value === 'rule'
  )
    category.value = value
}
function select(key: string): void {
  if (!props.disabled && !list.loading.value) selectedKey.value = key
}
const selected = computed(() =>
  PIPELINE_TEMPLATES.find((item) => item.key === selectedKey.value),
)
const graph = computed(() => selected.value?.build())
watch(category, () => void list.reloadFromFirstPage())
onMounted(() => void list.reload())
</script>

<template>
  <section class="template-picker" aria-label="选择设计模板">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-section font-semibold">选择设计模板</h2>
      <DtSegmented
        :model-value="category"
        :options="categories"
        :disabled="disabled"
        aria-label="模板用途"
        @update:model-value="setCategory"
      />
    </div>
    <div class="template-picker__body">
      <div class="template-picker__catalog">
        <form class="flex items-center gap-2" @submit.prevent="void search()">
          <DtInput
            v-model="keyword"
            type="search"
            size="sm"
            placeholder="搜索用途，例如能耗、负荷"
            aria-label="搜索设计模板"
            :maxlength="128"
            :disabled="disabled"
            class="min-w-0 flex-1"
          />
          <DtButton
            type="submit"
            size="sm"
            variant="ghost"
            :disabled="disabled"
          >
            搜索
          </DtButton>
        </form>
        <DtNotice v-if="list.error.value" intent="danger">
          {{ list.error.value }}
          <DtButton size="sm" variant="ghost" @click="void list.reload()">
            重试
          </DtButton>
        </DtNotice>
        <DtSpinner v-if="list.loading.value" label="正在加载设计模板" />
        <div
          class="template-picker__options"
          role="group"
          aria-label="设计模板目录"
        >
          <DtButton
            v-for="item in list.items.value"
            :key="item.key"
            class="template-picker__option"
            size="sm"
            :pressed="selectedKey === item.key"
            :disabled="disabled || list.loading.value"
            :title="item.label"
            @click="select(item.key)"
          >
            {{ item.label }}
          </DtButton>
          <DtEmpty
            v-if="
              !list.loading.value &&
              !list.error.value &&
              list.items.value.length === 0
            "
            inline
            title="没有匹配的设计模板"
            hint="试试其他关键词或切换到全部。"
          />
        </div>
        <DtPagination
          v-if="list.total.value > 0"
          :page="list.pager.value.page"
          :size="list.pager.value.size"
          :total="list.total.value"
          aria-label="设计模板分页"
          @update:page="void list.goToPage($event)"
          @update:size="void list.setSize($event)"
        />
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
