<script setup lang="ts">
/** @fileoverview 受保护全量帧下载，支持取消、下载状态与错误提示。 */
import { DtButton, DtNotice } from '@dt/ui'
import { computed, onScopeDispose, ref, watch } from 'vue'

import type { ModelingFrameTarget } from '@/api/modeling'
import { readModelingFrame } from '@/api/modeling'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { downloadBytes } from '@/utils/downloadJson'

const props = defineProps<{ target: ModelingFrameTarget | null }>()
const race = useRacedFetch()
const isLoading = ref(false)
const failure = ref('')

const identity = computed(() =>
  JSON.stringify([
    props.target?.runId,
    props.target?.nodeId,
    props.target?.port,
  ]),
)

function save(): void {
  const target = props.target
  if (target === null || isLoading.value) return
  isLoading.value = true
  failure.value = ''
  void race.run((signal) => readModelingFrame(target, signal), {
    ok: (blob) =>
      downloadBytes(
        blob,
        `modeling-${target.runId}-${target.nodeId}-${target.port}.csv`,
      ),
    fail: (caught) => {
      failure.value =
        caught instanceof Error && caught.message !== ''
          ? caught.message
          : '这份全量结果取不回来'
    },
    settled: () => {
      isLoading.value = false
    },
  })
}

watch(identity, () => {
  race.cancel()
  isLoading.value = false
  failure.value = ''
})
onScopeDispose(() => race.cancel())
</script>

<template>
  <div v-if="props.target !== null" class="dt-ml-frame-download">
    <DtButton variant="ghost" size="sm" :loading="isLoading" @click="save">
      {{ isLoading ? '下载中…' : '下载全量结果' }}
    </DtButton>
    <DtNotice v-if="failure" intent="danger">{{ failure }}</DtNotice>
  </div>
</template>

<style scoped lang="scss">
.dt-ml-frame-download {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.375rem;
}
</style>
