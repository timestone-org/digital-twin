<script setup lang="ts">
/** @fileoverview 来源管理弹窗；不增加权限，创建与人工同步沿用原权限码。 */
import { ref, watch } from 'vue'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtModal, DtNotice } from '@dt/ui'
import type {
  KnowledgeBase,
  KnowledgeSource,
  PlatformSourceConfig,
} from '@/api/knowledge'
import PermGuard from '@/components/PermGuard.vue'
import KnowledgeSourceForm from './KnowledgeSourceForm.vue'
import KnowledgeSourceList from './KnowledgeSourceList.vue'
import { useKnowledgeSources } from '../scripts/useKnowledgeSources'

const props = defineProps<{
  modelValue: boolean
  base: KnowledgeBase | null
  sourceKinds: readonly string[]
}>()
const emit = defineEmits<{ 'update:modelValue': [open: boolean]; synced: [] }>()
const page = useKnowledgeSources(
  () => props.base?.id ?? '',
  () => props.modelValue,
)
const formKey = ref(0)
const isDirty = ref(false)
watch(
  () => [props.modelValue, props.base?.id],
  () => {
    page.cancel()
    isDirty.value = false
    formKey.value += 1
    if (props.modelValue) void page.reload()
  },
  { immediate: true },
)

function close(open: boolean): void {
  if (!page.isBusy.value) emit('update:modelValue', open)
}

async function add(name: string, config: PlatformSourceConfig): Promise<void> {
  if (await page.add(name, config)) formKey.value += 1
}

async function sync(source: KnowledgeSource): Promise<void> {
  if (await page.sync(source)) emit('synced')
}
</script>

<template>
  <DtModal
    :model-value="modelValue"
    :title="`来源配置 · ${base?.name ?? ''}`"
    width="58rem"
    :dirty="isDirty"
    @update:model-value="close"
  >
    <DtNotice intent="warning"
      >同步用你当前的权限读取资料；摄入后，拥有 knowledge:use
      的用户可检索这些资料。</DtNotice
    >
    <DtNotice
      v-if="page.error.value !== ''"
      class="mt-3 break-all"
      intent="danger"
      >{{ page.error.value }}</DtNotice
    >
    <DtNotice v-if="page.result.value !== ''" class="mt-3" intent="success">{{
      page.result.value
    }}</DtNotice>
    <div class="mt-4 grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-2">
      <KnowledgeSourceList
        :base-name="base?.name ?? ''"
        :sources="page.sources.value"
        :is-busy="page.isBusy.value"
        :is-loading="page.isLoading.value"
        @reload="page.reload"
        @sync="sync"
      />
      <PermGuard :codes="[PERMISSION_CODES.knowledgeManage]">
        <KnowledgeSourceForm
          v-if="modelValue && sourceKinds.includes('platform')"
          :key="formKey"
          :is-busy="page.isBusy.value || page.isLoading.value"
          @submit="add"
          @dirty="isDirty = $event"
        />
        <DtNotice v-else intent="info"
          >当前部署未声明平台来源能力，不能添加。</DtNotice
        >
      </PermGuard>
    </div>
    <template #footer
      ><DtButton
        variant="ghost"
        :disabled="page.isBusy.value"
        @click="close(false)"
        >关闭</DtButton
      ></template
    >
  </DtModal>
</template>
