<script setup lang="ts">
/**
 * @fileoverview 导入大屏整包的确认：包已由父页面解析好，这里只挑「新建一张」
 * 还是「覆盖已有屏」，再给个名字。
 *
 * ⚠ 覆盖是就地换配置：目标屏的 id 与名字都不变，原有节点与绑定被整树换掉，
 * 且不可撤销——这句话必须写在界面上，不然用户会以为覆盖只是「再导一份」。
 */
import { computed, ref, watch } from 'vue'
import {
  DtButton,
  DtInput,
  DtModal,
  DtNotice,
  DtSegmented,
  DtSelect,
} from '@dt/ui'
import type {
  DashboardExportPayload,
  DtSegmentedOption,
  DtSelectOption,
} from '@dt/contracts'

const props = withDefaults(
  defineProps<{
    open: boolean
    payload: DashboardExportPayload | null
    projectName?: string | undefined
    /** 目标项目下已有同名屏。 */
    conflict: boolean
    loading?: boolean
    /** 目标项目里可被覆盖的屏。 */
    targets: readonly { id: string; name: string }[]
  }>(),
  { projectName: '', loading: false },
)

const emit = defineEmits<{
  'update:open': [open: boolean]
  submit: [payload: { newName: string; targetDashboardId: string | null }]
}>()

const MODES: readonly DtSegmentedOption[] = [
  { value: 'new', label: '新建一张', icon: 'plus' },
  { value: 'overwrite', label: '覆盖已有大屏', icon: 'upload' },
]

const mode = ref<'new' | 'overwrite'>('new')
const newName = ref('')
const targetId = ref('')

const targetOptions = computed<DtSelectOption[]>(() =>
  props.targets.map((target) => ({ value: target.id, label: target.name })),
)

const targetName = computed(
  () =>
    props.targets.find((target) => target.id === targetId.value)?.name ?? '',
)

const nodeCount = computed(() => props.payload?.nodes.length ?? 0)

const canSubmit = computed(() => {
  if (props.loading || props.payload === null) return false
  if (mode.value === 'overwrite') return targetId.value !== ''
  return newName.value.trim() !== ''
})

watch(
  () => props.open,
  (open) => {
    const incoming = props.payload
    if (!open || incoming === null) return
    mode.value = 'new'
    newName.value = props.conflict ? `${incoming.name} 副本` : incoming.name
    targetId.value = props.targets[0]?.id ?? ''
  },
  { immediate: true },
)

/** 分段器只认字符串，这里收窄回两档之一。 */
function onMode(value: string): void {
  if (value === 'new' || value === 'overwrite') mode.value = value
}

function submit(): void {
  if (!canSubmit.value) return
  if (mode.value === 'overwrite') {
    emit('submit', { newName: '', targetDashboardId: targetId.value })
    return
  }
  emit('submit', { newName: newName.value.trim(), targetDashboardId: null })
}
</script>

<template>
  <DtModal
    :model-value="open"
    title="导入大屏"
    width="38rem"
    :close-on-backdrop="!loading"
    @update:model-value="emit('update:open', $event)"
  >
    <div v-if="payload" class="flex flex-col gap-4">
      <div class="rounded-md border border-border-subtle bg-surface-sunken p-3">
        <p class="truncate text-sm text-text-primary">{{ payload.name }}</p>
        <p class="mt-1 text-2xs text-text-disabled">
          {{ payload.designWidth }} × {{ payload.designHeight }} ·
          {{ nodeCount }} 个节点 · 导入到
          {{ projectName === '' ? '当前项目' : projectName }}
        </p>
      </div>

      <DtSegmented
        :model-value="mode"
        :options="MODES"
        aria-label="导入方式"
        @update:model-value="onMode"
      />

      <DtInput
        v-if="mode === 'new'"
        v-model="newName"
        label="导入后的名称"
        required
        @enter="submit"
      />
      <DtSelect
        v-else-if="targetOptions.length > 0"
        v-model="targetId"
        label="覆盖到哪张大屏"
        required
        :options="targetOptions"
      />

      <DtNotice
        v-if="conflict && mode === 'new'"
        intent="warning"
        icon="alert-triangle"
      >
        这个项目下已经有同名大屏，名字后面加了「副本」。可以直接导入，也可以改名。
      </DtNotice>
      <DtNotice
        v-if="mode === 'overwrite' && targets.length === 0"
        intent="warning"
        icon="alert-triangle"
      >
        当前项目下还没有可覆盖的大屏，改用「新建一张」。
      </DtNotice>
      <DtNotice
        v-else-if="mode === 'overwrite'"
        intent="danger"
        icon="alert-triangle"
      >
        将把{{
          targetName === '' ? '所选大屏' : `「${targetName}」`
        }}的节点、绑定与主题整体换成包里的内容。 id
        与名字保持不变，此操作不可撤销。
      </DtNotice>
      <DtNotice v-else-if="mode === 'new'" icon="circle-question">
        指向本部署不存在的点位的绑定照常入库，导入完会逐条列出来。
      </DtNotice>
    </div>

    <template #footer>
      <DtButton
        variant="ghost"
        size="sm"
        :disabled="loading"
        @click="emit('update:open', false)"
      >
        取消
      </DtButton>
      <DtButton
        size="sm"
        :icon="mode === 'overwrite' ? 'upload' : 'plus'"
        :intent="mode === 'overwrite' ? 'danger' : 'primary'"
        :loading="loading ?? false"
        :disabled="!canSubmit"
        @click="submit"
      >
        {{ mode === 'overwrite' ? '覆盖导入' : '导入' }}
      </DtButton>
    </template>
  </DtModal>
</template>
