<script setup lang="ts">
/** @fileoverview 在创建弹窗中分页查找已保存的命名模板。 */
import type { ModelingTemplate } from '@dt/contracts'
import {
  DtIconButton,
  DtEmpty,
  DtInput,
  DtNotice,
  DtPagination,
  DtSpinner,
} from '@dt/ui'
import { onMounted, ref } from 'vue'
import { listTemplates } from '@/api/modelingTemplates'
import { useAsyncList } from '@/composables/useAsyncList'
import {
  savedTemplateKey,
  type WorkflowTemplateChoice,
} from '../scripts/workflowTemplateChoice'
import SavedTemplateCard from './SavedTemplateCard.vue'

defineProps<{ selectedKey: string }>()
const emit = defineEmits<{ select: [choice: WorkflowTemplateChoice] }>()
const keyword = ref('')
const appliedKeyword = ref('')
const list = useAsyncList<ModelingTemplate>((query, signal) =>
  listTemplates({ ...query, q: appliedKeyword.value }, signal),
)

async function search(): Promise<void> {
  appliedKeyword.value = keyword.value.trim()
  await list.reloadFromFirstPage()
}

function select(template: ModelingTemplate): void {
  if (list.loading.value || !template.is_enabled) return
  emit('select', {
    key: savedTemplateKey(template.id),
    label: `${template.name} v${template.version}`,
  })
}

onMounted(() => void list.reload())
</script>

<template>
  <section class="saved-template-picker" aria-label="已保存的工作流模板">
    <form @submit.prevent="void search()">
      <DtInput
        v-model="keyword"
        type="search"
        label="搜索已保存模板"
        placeholder="按模板名称或编码搜索"
      >
        <template #actions>
          <DtIconButton
            icon="search"
            label="搜索"
            tooltip="搜索已保存模板"
            @click="void search()"
          />
        </template>
      </DtInput>
    </form>
    <DtNotice v-if="list.error.value" intent="danger">
      {{ list.error.value }}
      <DtIconButton
        icon="refresh-cw"
        label="重试"
        tooltip="重新加载已保存模板"
        @click="void list.reload()"
      />
    </DtNotice>
    <DtSpinner v-if="list.loading.value" label="正在加载模板" />
    <div v-if="list.items.value.length" class="saved-template-picker__items">
      <SavedTemplateCard
        v-for="template in list.items.value"
        :key="template.id"
        :template="template"
        :is-selected="selectedKey === savedTemplateKey(template.id)"
        :is-disabled="list.loading.value"
        @select="select(template)"
      />
    </div>
    <DtEmpty
      v-else-if="!list.loading.value && !list.error.value"
      inline
      :title="appliedKeyword ? '没有匹配的已保存模板' : '还没有已保存模板'"
      :hint="
        appliedKeyword
          ? '试试其他模板名称或编码。'
          : '在工作流的更多操作中选择“保存为模板”，命名后即可在这里使用。'
      "
    />
    <DtPagination
      v-if="list.total.value > 0"
      :page="list.pager.value.page"
      :size="list.pager.value.size"
      :total="list.total.value"
      aria-label="已保存模板分页"
      @update:page="void list.goToPage($event)"
      @update:size="void list.setSize($event)"
    />
  </section>
</template>

<style scoped lang="scss">
.saved-template-picker {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  &__items {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
}
</style>
