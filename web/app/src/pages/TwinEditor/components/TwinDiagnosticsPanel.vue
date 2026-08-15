<script setup lang="ts">
/**
 * @fileoverview 诊断清单：把 `collectTwinConfigIssues` 的产出逐条列出来，
 * 点一条跳到出问题的实体。它只报不修——静默清理悬空引用会让用户以为
 * 自己配的东西凭空消失了（ADR-0012 四）。
 */
import type { TwinConfigIssue } from '@dt/twin-config'
import { DtIcon } from '@dt/ui'

import { TWIN_ISSUE_LABELS, twinIssueSelection } from '../outlineNodes'
import type { TwinSelection } from '../types'

defineProps<{ issues: readonly TwinConfigIssue[] }>()

const emit = defineEmits<{ focus: [TwinSelection] }>()

/** 落不到任何实体上的问题只显示、不可点。 */
function canFocus(issue: TwinConfigIssue): boolean {
  return twinIssueSelection(issue) !== null
}

function focus(issue: TwinConfigIssue): void {
  const selection = twinIssueSelection(issue)
  if (selection !== null) emit('focus', selection)
}
</script>

<template>
  <div class="flex flex-col gap-1 p-2" data-test="twin-diagnostics">
    <p
      v-if="issues.length === 0"
      class="px-1 py-4 text-center text-xs text-text-disabled"
      data-test="diagnostics-empty"
    >
      没有发现配置问题
    </p>
    <button
      v-for="issue in issues"
      :key="`${issue.kind}:${issue.path}`"
      type="button"
      class="flex w-full flex-col gap-0.5 rounded-[var(--radius-sm)] border border-border-subtle px-2 py-1.5 text-left text-2xs text-text-secondary enabled:hover:border-accent-primary enabled:hover:text-text-primary disabled:cursor-default"
      data-test="diagnostics-row"
      :data-kind="issue.kind"
      :disabled="!canFocus(issue)"
      @click="focus(issue)"
    >
      <span class="flex items-center gap-1 text-state-danger">
        <DtIcon name="alert-triangle" :size="12" />
        <span class="font-medium">{{ TWIN_ISSUE_LABELS[issue.kind] }}</span>
        <span class="min-w-0 flex-1 truncate text-3xs text-text-disabled">
          {{ issue.path }}
        </span>
      </span>
      <span>{{ issue.detail }}</span>
    </button>
  </div>
</template>
