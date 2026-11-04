<script setup lang="ts">
/** @fileoverview 建模批量操作的选择数量、执行进度与逐项失败反馈。 */
import { DtButton, DtDisclosure, DtNotice } from '@dt/ui'
import { computed } from 'vue'
import type { ModelingBatchState } from '../scripts/modelingBatch'

const props = withDefaults(
  defineProps<{
    selectedCount: number
    state: ModelingBatchState
    scopeLabel?: string
  }>(),
  { scopeLabel: '仅对当前页选中项执行' },
)
const emit = defineEmits<{ clear: []; stop: [] }>()
const visible = computed(
  () =>
    props.selectedCount > 0 ||
    props.state.isBusy ||
    props.state.outcomes.length > 0,
)
const problems = computed(() =>
  props.state.outcomes.filter((row) => row.status !== 'succeeded'),
)
const counts = computed(() => {
  const result = { succeeded: 0, failed: 0, unknown: 0, skipped: 0 }
  for (const row of props.state.outcomes) result[row.status] += 1
  return result
})
const hasUnknown = computed(() => counts.value.unknown > 0)
</script>

<template>
  <section
    v-if="visible"
    class="flex shrink-0 flex-col gap-2 rounded-md border border-border-subtle bg-surface-panel p-3"
    aria-label="批量操作"
    :aria-busy="state.isBusy"
  >
    <div class="flex flex-wrap items-center gap-2">
      <strong>已选择 {{ selectedCount }} 项</strong>
      <span class="text-caption text-text-secondary">{{ scopeLabel }}</span>
      <slot />
      <DtButton
        v-if="state.isBusy"
        size="sm"
        variant="ghost"
        @click="emit('stop')"
        >停止后续操作</DtButton
      >
      <DtButton
        size="sm"
        variant="ghost"
        :disabled="state.isBusy"
        @click="emit('clear')"
        >清除选择与结果</DtButton
      >
    </div>
    <p
      v-if="state.total > 0"
      class="m-0 text-caption text-text-secondary"
      role="status"
      aria-live="polite"
    >
      {{ state.label }}：{{ state.completed }}/{{ state.total }} 项已处理，成功
      {{ counts.succeeded }} 项，失败 {{ counts.failed }} 项，待核查
      {{ counts.unknown }} 项，未执行 {{ counts.skipped }} 项。
    </p>
    <DtNotice v-if="hasUnknown" intent="warning">
      有操作结果待核查，已停止提交剩余项。请先检查实际状态，再清除选择重新操作；系统不会自动重试。
    </DtNotice>
    <DtDisclosure
      v-if="problems.length"
      :title="`查看 ${problems.length} 项未完成结果`"
      :default-open="false"
    >
      <ul
        class="m-0 max-h-44 overflow-y-auto pl-5 text-caption text-text-secondary"
        aria-label="批量操作结果"
      >
        <li v-for="row in problems" :key="row.id">
          {{ row.label }} ·
          {{
            row.status === 'unknown'
              ? '结果待核查'
              : row.status === 'skipped'
                ? '未执行'
                : '失败'
          }}：{{ row.message }}
        </li>
      </ul>
    </DtDisclosure>
  </section>
</template>
