<script setup lang="ts">
/** @fileoverview 训练历史筛选器：分页检索后端工作流目录。 */
import type { ModelingPipelineSummary } from '@dt/contracts'
import {
  DtButton,
  DtEmpty,
  DtInput,
  DtModal,
  DtNotice,
  DtPagination,
  DtSpinner,
} from '@dt/ui'
import { onMounted, ref } from 'vue'
import { listModelingPipelines } from '@/api/modeling'
import { useAsyncList } from '@/composables/useAsyncList'

defineProps<{ selectedId: string }>()
const emit = defineEmits<{
  select: [row: ModelingPipelineSummary | null]
  close: []
}>()
const keyword = ref('')
const appliedKeyword = ref('')
const list = useAsyncList<ModelingPipelineSummary>((query, signal) =>
  listModelingPipelines({ ...query, q: appliedKeyword.value }, signal),
)
async function search(): Promise<void> {
  appliedKeyword.value = keyword.value.trim()
  await list.reloadFromFirstPage()
}
function select(row: ModelingPipelineSummary | null): void {
  if (!list.loading.value) emit('select', row)
}
onMounted(() => void list.reload())
</script>

<template>
  <DtModal
    :model-value="true"
    title="筛选工作流"
    width="42rem"
    @update:model-value="emit('close')"
  >
    <div class="run-workflow-picker">
      <form class="flex items-end gap-2" @submit.prevent="void search()">
        <DtInput
          v-model="keyword"
          class="min-w-0 flex-1"
          label="搜索工作流目录"
          type="search"
          placeholder="按工作流名称或编码搜索"
          :maxlength="128"
        />
        <DtButton type="submit" variant="ghost">搜索</DtButton>
      </form>
      <DtButton
        variant="ghost"
        :disabled="list.loading.value"
        :aria-pressed="selectedId === ''"
        @click="select(null)"
        >全部工作流</DtButton
      >
      <DtNotice v-if="list.error.value" intent="danger">
        {{ list.error.value }}
        <DtButton variant="ghost" @click="void list.reload()">重试</DtButton>
      </DtNotice>
      <DtSpinner v-if="list.loading.value" label="正在加载工作流" />
      <div v-if="list.items.value.length" class="run-workflow-picker__items">
        <DtButton
          v-for="row in list.items.value"
          :key="row.id"
          variant="outline"
          :disabled="list.loading.value"
          :aria-pressed="selectedId === row.id"
          :aria-label="`选择工作流 ${row.name}`"
          @click="select(row)"
        >
          <span class="run-workflow-picker__label"
            >{{ row.name }} · {{ row.code }}</span
          >
        </DtButton>
      </div>
      <DtEmpty
        v-else-if="!list.loading.value && !list.error.value"
        inline
        title="没有匹配的工作流"
        hint="试试其他工作流名称或编码。"
      />
      <DtPagination
        v-if="list.total.value > 0"
        :page="list.pager.value.page"
        :size="list.pager.value.size"
        :total="list.total.value"
        aria-label="工作流目录分页"
        @update:page="void list.goToPage($event)"
        @update:size="void list.setSize($event)"
      />
    </div>
  </DtModal>
</template>

<style scoped lang="scss">
.run-workflow-picker {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-height: 0;
  &__items {
    display: grid;
    gap: 0.5rem;
  }
  &__label {
    display: flex;
    min-width: 0;
    overflow-wrap: anywhere;
    text-align: left;
  }
}
</style>
