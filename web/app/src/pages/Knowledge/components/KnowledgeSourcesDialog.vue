<script setup lang="ts">
/** @fileoverview 来源管理弹窗；不增加权限，创建与人工同步沿用原权限码。 */
import { ref, shallowRef, watch } from 'vue'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtModal, DtNotice, useConfirm } from '@dt/ui'
import type {
  KnowledgeBase,
  KnowledgeSource,
  PlatformSourceConfig,
} from '@/api/knowledge'
import PermGuard from '@/components/PermGuard.vue'
import KnowledgeSourceForm from './KnowledgeSourceForm.vue'
import KnowledgeSourceList from './KnowledgeSourceList.vue'
import { sourcePatch } from '../scripts/sourceMetadata'
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
const editing = shallowRef<KnowledgeSource>()
const confirm = useConfirm()
// ⚠ 多源写法逐项比较：轮询刷新计数会换掉 base 的对象身份，getter 返回新数组会误触发重置
watch(
  [() => props.modelValue, () => props.base?.id],
  () => {
    page.cancel()
    editing.value = undefined
    isDirty.value = false
    formKey.value += 1
    if (props.modelValue) void page.reload()
  },
  { immediate: true },
)

function close(open: boolean): void {
  if (!page.isBusy.value) emit('update:modelValue', open)
}

function resetForm(): void {
  editing.value = undefined
  isDirty.value = false
  formKey.value += 1
}

async function choose(source: KnowledgeSource): Promise<void> {
  if (
    isDirty.value &&
    !(await confirm.ask({
      title: '切换来源',
      message: '放弃当前表单中尚未保存的变更？',
      confirmText: '放弃变更',
    }))
  )
    return
  if (!props.modelValue || props.base?.id !== source.baseId) return
  editing.value = source
  isDirty.value = false
  formKey.value += 1
}

async function save(name: string, config: PlatformSourceConfig): Promise<void> {
  const source = editing.value
  if (source) {
    const changes = sourcePatch(source, name, config)
    if (Object.keys(changes).length === 0 || (await page.edit(source, changes)))
      resetForm()
  } else if (await page.add(name, config)) resetForm()
}

async function detach(source: KnowledgeSource): Promise<void> {
  if ((await page.detach(source)) && editing.value?.id === source.id)
    resetForm()
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
        @edit="choose"
        @detach="detach"
      />
      <PermGuard :codes="[PERMISSION_CODES.knowledgeManage]">
        <KnowledgeSourceForm
          v-if="modelValue && sourceKinds.includes('platform')"
          :key="formKey"
          :source="editing"
          :is-busy="page.isBusy.value || page.isLoading.value"
          @submit="save"
          @cancel="resetForm"
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
