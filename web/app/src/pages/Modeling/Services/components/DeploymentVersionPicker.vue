<script setup lang="ts">
/** @fileoverview 同工作流与任务类型的可服务版本后端检索与分页选择。 */
import type {
  ModelDeployment,
  ModelingVersion,
  ModelingVersionSummary,
  Page,
} from '@dt/contracts'
import {
  DtIconButton,
  DtInput,
  DtNotice,
  DtPagination,
  DtSelect,
  DtSpinner,
} from '@dt/ui'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import * as modeling from '@/api/modeling'
import { describeError, useAsyncList } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'

const props = defineProps<{
  deployment: ModelDeployment
  modelValue: string
  disabled: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [id: string]
  ready: [ready: boolean]
}>()
const pinned = ref<ModelingVersion | null>(null)
const selected = ref<ModelingVersionSummary | null>(null)
const keyword = ref('')
const appliedQuery = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const read = useRacedFetch()
const list = useAsyncList<ModelingVersionSummary>((query, signal) => {
  const version = pinned.value
  if (version === null)
    return Promise.resolve<Page<ModelingVersionSummary>>({
      ...query,
      items: [],
      total: 0,
    })
  return modeling.listModelingVersions(
    {
      ...query,
      q: appliedQuery.value,
      pipelineId: version.pipeline_id,
      task: version.task,
      isServable: true,
      archived: 'active',
    },
    signal,
  )
})
const candidates = computed(() => {
  const found = new Map<string, ModelingVersionSummary>()
  for (const row of [pinned.value, selected.value, ...list.items.value]) {
    if (row !== null) found.set(row.id, row)
  }
  return [...found.values()]
})
const options = computed(() =>
  candidates.value.map((row) => ({
    value: row.id,
    label: `${row.name} v${row.version}`,
    disabled: !row.is_servable || row.archived_at != null,
  })),
)
const ready = computed(
  () =>
    !loading.value &&
    pinned.value !== null &&
    candidates.value.some(
      (row) =>
        row.id === props.modelValue &&
        row.is_servable &&
        row.archived_at == null,
    ),
)

async function load(): Promise<void> {
  pinned.value = null
  selected.value = null
  loading.value = true
  error.value = null
  appliedQuery.value = ''
  keyword.value = ''
  void list.reloadFromFirstPage()
  await read.run(
    (signal) =>
      modeling.getModelingVersion(props.deployment.model_version_id, signal),
    {
      ok: (version) => {
        pinned.value = version
        void list.reloadFromFirstPage()
      },
      fail: (caught) => {
        error.value = describeError(caught)
      },
      settled: () => {
        loading.value = false
      },
    },
  )
}
async function search(): Promise<void> {
  appliedQuery.value = keyword.value.trim()
  await list.reloadFromFirstPage()
}
function choose(id: string): void {
  if (props.disabled || loading.value || list.loading.value) return
  const row = candidates.value.find((entry) => entry.id === id)
  if (!row || !row.is_servable || row.archived_at != null) return
  selected.value = row
  emit('update:modelValue', id)
}
watch(
  () => props.deployment.model_version_id,
  () => void load(),
  { immediate: true },
)
watch(ready, (value) => emit('ready', value), { immediate: true })
onBeforeUnmount(read.cancel)
</script>

<template>
  <section class="flex flex-col gap-3" aria-label="部署模型版本选择">
    <form @submit.prevent="void search()">
      <DtInput
        v-model="keyword"
        type="search"
        label="搜索可切换模型版本"
        aria-label="搜索可切换模型版本"
        :maxlength="128"
        :disabled="disabled || loading || pinned === null"
        placeholder="按模型名称、算法或说明搜索"
      >
        <template #actions
          ><DtIconButton
            icon="search"
            label="搜索可切换模型版本"
            :disabled="disabled || loading || pinned === null"
            @click="void search()"
        /></template>
      </DtInput>
    </form>
    <DtNotice v-if="error" intent="danger"
      >当前模型版本加载失败：{{ error
      }}<DtIconButton
        icon="refresh-cw"
        label="重试当前模型版本"
        @click="void load()"
    /></DtNotice>
    <DtNotice v-else-if="list.error.value" intent="danger"
      >模型版本检索失败：{{ list.error.value
      }}<DtIconButton
        icon="refresh-cw"
        label="重试模型版本检索"
        @click="void list.reload()"
    /></DtNotice>
    <DtSpinner v-if="loading || list.loading.value" label="正在读取模型版本" />
    <DtSelect
      :model-value="modelValue"
      label="钉住的模型版本"
      hint="仅检索同一工作流、相同任务类型的可服务版本；当前选中版本保持可见"
      :options="options"
      :display="{ searchable: false }"
      :disabled="disabled || loading"
      @update:model-value="choose"
    />
    <DtNotice v-if="pinned && !pinned.is_servable" intent="warning"
      >当前固定版本不可服务，请选择可服务版本再保存。</DtNotice
    >
    <DtPagination
      v-if="list.total.value > 0"
      :page="list.pager.value.page"
      :size="list.pager.value.size"
      :total="list.total.value"
      aria-label="可切换模型版本分页"
      @update:page="void list.goToPage($event)"
      @update:size="void list.setSize($event)"
    />
  </section>
</template>
