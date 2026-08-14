<script setup lang="ts">
/**
 * @fileoverview `type: 'dashboard-ref'` 的控件：在当前项目下挑另一张大屏，值是大屏 id。
 * ⚠ 没有项目上下文、或列表没拉成时**说出来**并留一个手填框：一个空下拉与一次
 * 没查成，用户分不出来，而后者手填 id 仍然能用。
 * ⚠ 项目会被切换，慢的那次后返回会把新项目的候选覆盖成旧项目的，所以走序号防竞态。
 */
import type { DtSelectOption } from '@dt/contracts'
import { readText } from '@dt/modules'
import { DtInput, DtNotice, DtSelect } from '@dt/ui'
import { computed, ref, watch } from 'vue'

import { useRacedFetch } from '@/composables/useRacedFetch'
import { useEditorProjectId } from '../editorContext'
import { loadProjectDashboards } from './dashboardOptions'
import type { ConfigControlEmits, ConfigControlProps } from './controlProps'

const props = defineProps<ConfigControlProps>()
const emit = defineEmits<ConfigControlEmits>()

/** 空串这一项就是「不引用任何大屏」。 */
const NONE_OPTION: DtSelectOption = { value: '', label: '（未选择）' }

const projectId = useEditorProjectId()
const raced = useRacedFetch()

const loaded = ref<DtSelectOption[]>([])
const loading = ref(false)
const failed = ref(false)

const current = computed(() => readText(props.value))
const hasProject = computed(() => (projectId?.value ?? '') !== '')
/** 拿得到候选才给下拉，否则退回手填，不给一个骗人的空下拉。 */
const canPick = computed(() => hasProject.value && !failed.value)

const options = computed<DtSelectOption[]>(() => {
  const listed = [NONE_OPTION, ...loaded.value]
  // 已选的大屏可能已被删掉或属于别的项目，补一条占位，免得回显成「未选择」
  if (current.value !== '' && !listed.some((o) => o.value === current.value)) {
    listed.push({ value: current.value, label: `（列表外 ${current.value}）` })
  }
  return listed
})

function write(raw: string): void {
  emit('update', raw === '' ? undefined : raw, false)
}

watch(
  () => projectId?.value ?? '',
  (id) => {
    loaded.value = []
    failed.value = false
    if (id === '') return
    loading.value = true
    void raced.run(() => loadProjectDashboards(id), {
      ok: (list) => {
        loaded.value = list.map((item) => ({
          value: item.id,
          label: item.name,
        }))
      },
      fail: () => {
        failed.value = true
      },
      settled: () => {
        loading.value = false
      },
    })
  },
  { immediate: true },
)
</script>

<template>
  <DtSelect
    v-if="canPick"
    :model-value="current"
    :options="options"
    size="sm"
    :disabled="disabled === true || loading"
    :aria-label="field.label"
    @update:model-value="write"
  />
  <div v-else class="flex flex-col gap-1">
    <DtNotice intent="warning" icon="alert-triangle">
      取不到大屏列表，这里只能手填大屏 id。
    </DtNotice>
    <DtInput
      :model-value="current"
      size="sm"
      :disabled="disabled"
      :placeholder="field.placeholder ?? '目标大屏 id'"
      @update:model-value="write"
    />
  </div>
</template>
