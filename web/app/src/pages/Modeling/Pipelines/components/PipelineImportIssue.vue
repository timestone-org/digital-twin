<script setup lang="ts">
/** @fileoverview 导入预检中一条错误或待核对问题。 */
import type { ModelingTransferIssue } from '@dt/contracts'
import { DtTag } from '@dt/ui'
defineProps<{ issue: ModelingTransferIssue }>()
</script>

<template>
  <li>
    <DtTag :intent="issue.level === 'error' ? 'danger' : 'warning'" size="sm">
      {{ issue.level === 'error' ? '阻止导入' : '待核对' }}
    </DtTag>
    <span>
      {{ issue.message }}
      <small v-if="issue.node_id">（节点 {{ issue.node_id }}）</small>
    </span>
  </li>
</template>
