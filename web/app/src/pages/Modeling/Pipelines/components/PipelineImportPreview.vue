<script setup lang="ts">
/** @fileoverview 工作流文件的兼容性摘要与可定位问题清单。 */
import type { ModelingImportInspection } from '@dt/contracts'
import { DtNotice, DtTag } from '@dt/ui'
import PipelineImportIssue from './PipelineImportIssue.vue'
defineProps<{ inspection: ModelingImportInspection }>()
</script>

<template>
  <div class="pipeline-import-preview">
    <div class="pipeline-import-preview__summary">
      <DtTag :intent="inspection.can_import ? 'success' : 'danger'">{{
        inspection.can_import ? '可以导入' : '需要修正文件'
      }}</DtTag>
      <span
        >{{ inspection.node_count }} 个算子 ·
        {{ inspection.edge_count }} 条连线</span
      >
    </div>
    <DtNotice intent="warning"
      >导入创建新工作流，不覆盖当前系统中的已有内容。若编码已存在，请在下方填写新编码。跨部署后请核对台账、列与能管来源标识。</DtNotice
    >
    <ul
      v-if="inspection.issues.length"
      class="pipeline-import-preview__issues"
      aria-label="导入预检结果"
    >
      <PipelineImportIssue
        v-for="issue in inspection.issues"
        :key="`${issue.level}:${issue.node_id}:${issue.edge_id}:${issue.message}`"
        :issue="issue"
      />
    </ul>
  </div>
</template>

<style scoped lang="scss">
.pipeline-import-preview {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
  &__summary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    overflow-wrap: anywhere;
    font-size: var(--font-size-caption);
    color: var(--text-secondary);
  }
  &__issues {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-height: 14rem;
    overflow: auto;
    margin: 0;
    padding: 1rem;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    list-style: none;
  }
  &__issues li {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    font-size: var(--font-size-caption);
    overflow-wrap: anywhere;
  }
}
</style>
