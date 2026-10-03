<script setup lang="ts">
/** @fileoverview 服务端票据的逐次写确认；完整展示目标、参数与影响，不接受模型自拟确认。 */
import { computed } from 'vue'
import { DtButton, DtModal, DtNotice } from '@dt/ui'

import { useMcpWriteConfirmHost } from '@/features/ai/useMcpWriteConfirmHost'
import { formatDateTime } from '@/utils/datetime'

const { pending, choose } = useMcpWriteConfirmHost()
const argumentsText = computed(() =>
  JSON.stringify(pending.value?.request.arguments ?? {}, null, 2),
)
const expiresText = computed(() =>
  formatDateTime(pending.value?.request.expires_at ?? null),
)
</script>

<template>
  <DtModal
    :model-value="pending !== null"
    title="确认外部工具写操作"
    description="确认后将执行一次外部写操作，请核对目标、全部参数和影响。"
    width="48rem"
    layer="confirm"
    :close-on-backdrop="false"
    @update:model-value="choose(false)"
  >
    <div v-if="pending !== null" class="mcp-confirm">
      <DtNotice intent="warning">{{ pending.request.impact }}</DtNotice>
      <dl class="mcp-confirm__facts">
        <dt>工具</dt>
        <dd data-test="mcp-tool">{{ pending.request.tool_name }}</dd>
        <dt>目标</dt>
        <dd data-test="mcp-target">{{ pending.request.target }}</dd>
        <dt>确认有效期</dt>
        <dd>{{ expiresText }}</dd>
      </dl>
      <section aria-label="全部执行参数">
        <h3 class="m-0 mb-2 text-sm font-semibold text-text-title">全部参数</h3>
        <pre class="mcp-confirm__arguments" data-test="mcp-arguments">{{
          argumentsText
        }}</pre>
      </section>
      <DtNotice v-if="pending.isSubmitting" intent="info">
        正在提交决定并等待结果。已确认的操作不会因停止对话而被撤回。
      </DtNotice>
      <DtNotice v-if="pending.error !== null" intent="danger">
        {{ pending.error }}。请查看执行历史，不要重复提交。
      </DtNotice>
    </div>
    <template #footer>
      <DtButton
        variant="ghost"
        intent="neutral"
        :disabled="pending?.isSubmitting"
        @click="choose(false)"
      >
        {{ pending?.error ? '关闭' : '取消，不执行' }}
      </DtButton>
      <DtButton
        v-if="pending?.error === null"
        intent="danger"
        :loading="pending?.isSubmitting"
        :disabled="pending?.isSubmitting"
        @click="choose(true)"
      >
        确认并执行一次
      </DtButton>
    </template>
  </DtModal>
</template>

<style scoped lang="scss">
.mcp-confirm {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
  overflow-wrap: anywhere;
}

.mcp-confirm__facts {
  display: grid;
  grid-template-columns: 6rem minmax(0, 1fr);
  gap: 0.625rem 1rem;
  margin: 0;
  font-size: 0.875rem;

  dt {
    color: var(--text-secondary);
  }
  dd {
    margin: 0;
    color: var(--text-primary);
  }
}

.mcp-confirm__arguments {
  max-height: 38vh;
  overflow: auto;
  margin: 0;
  padding: 0.75rem;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
