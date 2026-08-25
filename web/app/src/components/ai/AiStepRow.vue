<script setup lang="ts">
/**
 * @fileoverview 助手做的一步 —— 界面上「AI 做了什么」逐条渲染的就是它。
 *
 * ⚠ 失败的一步照样要摆出来，而且要与成功的一眼分得开。藏起来的话，用户看到
 * 的是「助手做了几件事然后给了个奇怪的答复」，而看不出中间哪一步没成。
 */
import { computed } from 'vue'
import { DtIcon, DtTag } from '@dt/ui'
import type { IconName } from '@dt/ui'

import type { RunnerStep } from '@/features/ai/turnRunner'

const props = defineProps<{ step: RunnerStep }>()

/** 步骤种类 → 图标。⚠ 未登记的图标名会静默不渲染，只能用注册表里有的。 */
const KIND_ICONS: Record<string, IconName> = {
  model: 'sparkles',
  server_tool: 'activity',
  client_tool: 'square-mouse-pointer',
}

const icon = computed<IconName>(() => KIND_ICONS[props.step.kind] ?? 'activity')

const isFailed = computed(() => props.step.state === 'failed')
const isWaiting = computed(() => props.step.state === 'awaiting_client')
</script>

<template>
  <li class="ai-step" :class="{ 'ai-step--failed': isFailed }">
    <DtIcon :name="icon" :size="14" class="ai-step__icon" />
    <span class="ai-step__title">{{ step.title }}</span>
    <DtTag v-if="isWaiting" intent="info" size="sm">等页面执行</DtTag>
    <DtIcon
      v-else-if="isFailed"
      name="alert-circle"
      :size="14"
      class="ai-step__mark"
    />
    <DtIcon v-else name="check" :size="14" class="ai-step__mark" />
  </li>
  <li v-if="step.error" class="ai-step__reason">{{ step.error }}</li>
</template>

<style scoped lang="scss">
.ai-step {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.5rem;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 0.8125rem;
  line-height: 1.5;
}

.ai-step--failed {
  color: var(--state-danger);
}

.ai-step__icon {
  flex: none;
  color: var(--accent-primary);
}

.ai-step--failed .ai-step__icon,
.ai-step--failed .ai-step__mark {
  color: var(--state-danger);
}

.ai-step__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-step__mark {
  flex: none;
  color: var(--state-success);
}

.ai-step__reason {
  padding: 0 0.5rem 0.25rem 2rem;
  color: var(--state-danger);
  font-size: 0.75rem;
  line-height: 1.5;
}
</style>
