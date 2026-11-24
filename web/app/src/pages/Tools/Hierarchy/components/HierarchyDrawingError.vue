<script setup lang="ts">
/** @fileoverview 层级图出图诊断与对应节点的定位入口。 */
import { DtButton, DtDisclosure, DtNotice } from '@dt/ui'
import type { Issue } from '../scripts/types'

defineProps<{ error: string; issues: readonly Issue[] }>()
const emit = defineEmits<{ focus: [id: string] }>()
</script>
<template>
  <DtDisclosure
    v-if="issues.length"
    :title="error"
    :default-open="false"
    unmount-on-close
    class="drawing-issues"
  >
    <template #title>
      <span role="alert">{{ error }}（{{ issues.length }} 项）</span>
    </template>
    <div class="issue-list">
      <template v-for="issue in issues" :key="issue.message">
        <DtButton
          v-if="issue.nodeId"
          size="sm"
          variant="ghost"
          @click="emit('focus', issue.nodeId)"
          >{{ issue.message }}</DtButton
        >
        <span v-else>{{ issue.message }}</span>
      </template>
    </div>
  </DtDisclosure>
  <DtNotice v-else intent="danger">{{ error }}</DtNotice>
</template>
<style scoped lang="scss">
.drawing-issues {
  flex: none;
  border: 1px solid var(--state-danger);
  border-radius: var(--radius-md);
  background: var(--surface-panel);
  :deep(summary) {
    color: var(--state-danger);
  }
}
.issue-list {
  display: grid;
  justify-items: start;
  gap: 4px;
  max-height: min(9rem, 20dvh);
  overflow: auto;
  font-size: var(--font-size-compact);
  :deep(button) {
    max-width: 100%;
    height: auto;
    min-height: var(--ctl-h-sm);
    text-align: start;
    white-space: normal;
  }
  :deep(.dt-btn__label) {
    white-space: normal;
    overflow-wrap: anywhere;
  }
}
</style>
