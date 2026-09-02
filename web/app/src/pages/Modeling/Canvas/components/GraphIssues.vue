<script setup lang="ts">
/**
 * @fileoverview 图校验问题条：逐条列出，每条点得进对应那张卡片。
 *
 * ⚠ 不把问题拼成一串：拼串之后既读不出哪条对应哪张卡片，条目一多还会把整条
 * 提示挤成一大段。
 */
import { DtNotice } from '@dt/ui'

import type { IssueView } from '../scripts/graphIssues'

const props = defineProps<{ issues: readonly IssueView[] }>()

const emit = defineEmits<{ pick: [nodeId: string] }>()
</script>

<template>
  <DtNotice intent="warning" icon="alert-triangle">
    <ul class="dt-ml-issues">
      <li v-for="issue in props.issues" :key="issue.key">
        <button
          v-if="issue.nodeId !== ''"
          type="button"
          class="dt-ml-issues__where"
          @click="emit('pick', issue.nodeId)"
        >
          {{ issue.where }}
        </button>
        <span>{{ issue.message }}</span>
      </li>
    </ul>
  </DtNotice>
</template>

<style scoped lang="scss">
.dt-ml-issues {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  margin: 0;
  padding: 0;
  list-style: none;

  &__where {
    margin-right: 0.375rem;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    font-weight: 600;
    cursor: pointer;

    &:hover {
      text-decoration: underline;
    }
  }
}
</style>
