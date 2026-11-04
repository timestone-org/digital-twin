<script setup lang="ts">
/** @fileoverview 训练记录的主查看入口与按权限筛选的管理菜单。 */
import type { DtMenuItem, ModelingRunSummary } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtDropdownMenu, DtTooltip } from '@dt/ui'
import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
const props = defineProps<{ run: ModelingRunSummary; canPublish: boolean }>()
const emit = defineEmits<{
  detail: [run: ModelingRunSummary]
  publish: [run: ModelingRunSummary]
  remove: [run: ModelingRunSummary]
}>()
const auth = useAuthStore()
const disabled = computed(
  () => !props.canPublish || props.run.publication_status === 'pending',
)
const items = computed<readonly DtMenuItem[]>(() => {
  const actions: DtMenuItem[] = []
  if (
    props.run.status === 'succeeded' &&
    auth.can([PERMISSION_CODES.modelingPublish])
  ) {
    actions.push({
      value: 'publish',
      label: '发布模型',
      icon: 'share',
      disabled: disabled.value,
    })
  }
  const isTerminal = ['succeeded', 'failed', 'cancelled'].includes(
    props.run.status,
  )
  if (isTerminal && auth.can([PERMISSION_CODES.modelingManage])) {
    actions.push({
      value: 'remove',
      label: '删除记录',
      icon: 'trash',
      danger: true,
      disabled: disabled.value,
    })
  }
  return actions
})
function select(item: DtMenuItem): void {
  if (item.value === 'publish') emit('publish', props.run)
  if (item.value === 'remove') emit('remove', props.run)
}
</script>
<template>
  <div class="run-actions">
    <DtButton
      variant="soft"
      size="sm"
      icon="eye"
      aria-label="查看训练结果"
      @click="emit('detail', run)"
      >查看结果</DtButton
    >
    <DtDropdownMenu
      v-if="items.length > 0"
      :items="items"
      label="训练记录更多操作"
      size="sm"
      @select="select"
    >
      <template #trigger="{ toggle, isOpen, panelId }">
        <DtTooltip v-slot="{ describedby }" content="训练记录更多操作">
          <DtButton
            variant="ghost"
            intent="neutral"
            size="sm"
            icon="more-horizontal"
            aria-label="训练记录更多操作"
            aria-haspopup="menu"
            :aria-expanded="isOpen"
            :aria-controls="panelId"
            :aria-describedby="describedby"
            @click="toggle"
          />
        </DtTooltip>
      </template>
    </DtDropdownMenu>
  </div>
</template>
<style scoped lang="scss">
.run-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.375rem;
}
</style>
