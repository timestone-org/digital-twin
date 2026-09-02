<script setup lang="ts">
/**
 * @fileoverview 大屏自检结果：把服务端报告的悬空引用逐条摆出来。
 * 报告由父页面调 `validateDashboard` 拿到，这里只负责呈现三态（在查 / 全绿 / 有问题）。
 */
import { DtButton, DtModal, DtNotice, DtSpinner, DtTag } from '@dt/ui'

import type { ValidationReport } from '@/api/dashboard'

defineProps<{
  open: boolean
  loading: boolean
  result: ValidationReport | null
  dashboardName?: string | undefined
}>()

const emit = defineEmits<{ 'update:open': [open: boolean] }>()
</script>

<template>
  <DtModal
    :model-value="open"
    title="大屏自检"
    :description="dashboardName"
    width="40rem"
    @update:model-value="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-3">
      <DtSpinner v-if="loading" label="检查中…" />

      <template v-else-if="result">
        <DtNotice v-if="result.isValid" intent="success" icon="shield-check">
          全部引用都能解析，这张屏可以直接上线。
        </DtNotice>
        <DtNotice v-else intent="warning" icon="alert-triangle">
          有 {{ result.issues.length }} 处引用解析不了。它们不会让屏打不开，
          只会让对应位置一直没有数据。
        </DtNotice>

        <div v-if="result.issues.length > 0" class="dt-issues">
          <div
            v-for="issue in result.issues"
            :key="`${issue.field}|${issue.code}`"
            class="dt-issues__row"
          >
            <DtTag size="sm" intent="warning">{{ issue.code }}</DtTag>
            <span class="dt-issues__field" :title="issue.field">
              {{ issue.field }}
            </span>
            <span class="text-text-secondary">{{ issue.message }}</span>
          </div>
        </div>
      </template>

      <DtNotice v-else icon="circle-question"> 还没有自检结果。 </DtNotice>
    </div>

    <template #footer>
      <DtButton @click="emit('update:open', false)">关闭</DtButton>
    </template>
  </DtModal>
</template>

<style scoped lang="scss">
.dt-issues {
  max-height: 18rem;
  overflow-y: auto;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);

  &__row {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border-subtle);
    font-size: 12px;

    &:last-child {
      border-bottom: 0;
    }
  }

  &__field {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text-disabled);
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
  }
}
</style>
