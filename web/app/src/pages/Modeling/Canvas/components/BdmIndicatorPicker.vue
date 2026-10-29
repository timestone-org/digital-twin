<script setup lang="ts">
/** @fileoverview 从指标绑定发现可查询的产供用属性，不执行 KPI 公式或模型调用。 */
import type {
  ModelingBdmCatalogItem,
  ModelingBdmIndicator,
  ModelingBdmIndicatorSource,
} from '@dt/contracts'
import { DtButton, DtInput, DtNotice, DtPagination, DtTag } from '@dt/ui'
import { computed } from 'vue'

import { useBdmIndicators } from '../scripts/useBdmIndicators'

const props = defineProps<{
  selected: readonly string[]
  isReadonly: boolean
}>()
const emit = defineEmits<{ select: [value: ModelingBdmCatalogItem] }>()
const catalog = useBdmIndicators()
const { code, page, result, isLoading, error, total } = catalog
const isAddDisabled = computed(
  () => props.isReadonly || props.selected.length >= 10,
)
const choices = computed(() =>
  catalog.items.value.map((indicator) => ({
    ...indicator,
    sources: [
      ...new Map(
        indicator.sources.map((source) => [JSON.stringify(source), source]),
      ).entries(),
    ],
  })),
)

function add(
  indicator: Pick<ModelingBdmIndicator, 'name'>,
  source: ModelingBdmIndicatorSource,
): void {
  if (
    props.isReadonly ||
    !source.is_selectable ||
    !source.source_id ||
    props.selected.length >= 10 ||
    props.selected.includes(source.source_id)
  )
    return
  emit('select', {
    identifier: source.source_id,
    code: source.source_id,
    name: `${indicator.name} · ${source.alias || source.source_property || source.source_id}`,
    unit: source.unit,
    system: null,
    history_available: null,
  })
}
</script>

<template>
  <section class="dt-bdm-indicators" aria-label="指标来源绑定">
    <DtNotice intent="info">
      选择指标关联的产供用属性。这里只读取来源历史，不计算指标公式，也不调用预测模型。
    </DtNotice>
    <DtInput
      v-model="code"
      label="指标编码"
      placeholder="填写完整编码精确查找，留空查看全部"
      :maxlength="200"
      @enter="catalog.search"
    >
      <template #actions
        ><DtButton :disabled="isLoading" @click="catalog.search">
          查找指标
        </DtButton></template
      >
    </DtInput>
    <DtNotice v-if="error" intent="danger">
      {{ error }}
    </DtNotice>
    <DtButton v-if="error" variant="ghost" @click="catalog.load">
      重试指标目录
    </DtButton>
    <p v-if="isLoading" role="status">正在读取指标绑定…</p>
    <div v-else class="dt-bdm-indicators__items">
      <article v-for="indicator in choices" :key="indicator.id">
        <strong>
          {{ indicator.name }}
        </strong>
        <span class="dt-bdm-indicators__note">
          {{ indicator.code }}
        </span>
        <div
          v-for="[key, source] in indicator.sources"
          :key="key"
          class="dt-bdm-indicators__source"
        >
          <div>
            <span>
              {{
                source.alias ||
                source.source_property ||
                source.source_id ||
                '未命名来源'
              }}
            </span>
            <span class="dt-bdm-indicators__note">
              {{ source.source_id || '未提供标识'
              }}{{ source.unit ? ` · ${source.unit}` : '' }}
            </span>
            <span v-if="!source.is_selectable" class="dt-bdm-indicators__note">
              {{ source.source_type }} · 仅绑定信息，不能直接取历史值
            </span>
          </div>
          <DtTag
            v-if="source.source_id && props.selected.includes(source.source_id)"
            intent="success"
          >
            已添加
          </DtTag>
          <DtButton
            v-else-if="source.is_selectable"
            :disabled="isAddDisabled"
            @click="add(indicator, source)"
          >
            添加属性
          </DtButton>
        </div>
        <p v-if="!indicator.sources.length" class="dt-bdm-indicators__note">
          此指标尚未提供来源绑定。
        </p>
      </article>
      <p v-if="result && !choices.length">没有匹配指标，请核对完整编码。</p>
    </div>
    <DtPagination
      v-if="result"
      v-model:page="page"
      :size="50"
      :size-options="[50]"
      :total="total"
      aria-label="指标目录分页"
    />
  </section>
</template>

<style scoped lang="scss">
.dt-bdm-indicators {
  display: grid;
  gap: 0.75rem;
  padding: 0.75rem;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  &__items {
    display: grid;
    gap: 0.75rem;
    max-height: 18rem;
    overflow: auto;
  }
  article {
    display: grid;
    gap: 0.5rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--border-subtle);
  }
  &__source {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
  }
  &__source > div {
    display: grid;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  &__note {
    color: var(--text-secondary);
    font-size: var(--font-size-compact);
    overflow-wrap: anywhere;
  }
}
</style>
