<script setup lang="ts">
/**
 * @fileoverview 助手在页面右下角的那一坨：按钮与展开后的面板。
 *
 * ⚠ 三道闸串起来才决定它出不出现：没装前端适配（`installAiAssistant` 没调）、
 * 这套部署没有 ai-assistant 服务、这个账号没有 `assistant:use`——任一条成立
 * 都是干净地不出现，而不是出现一个点了报错的按钮。
 */
import type { AssistantSurfaceKind } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton } from '@dt/ui'

import AiAssistantPanel from '@/components/ai/AiAssistantPanel.vue'
import PermGuard from '@/components/PermGuard.vue'
import type { AiPanel } from '@/composables/useAiPanel'

defineProps<{
  ai: AiPanel
  surfaceKind: AssistantSurfaceKind
  /** 给人看的页面名，进提示词。 */
  surfaceLabel: string
  /** 摆在输入框上方的一句提醒，各页面自己给。 */
  hint: string
}>()
</script>

<template>
  <PermGuard :codes="[PERMISSION_CODES.assistantUse]">
    <div v-if="ai.isAvailable.value" class="ai-dock">
      <DtButton
        v-if="!ai.isOpen.value"
        variant="solid"
        size="sm"
        icon="sparkles"
        @click="() => void ai.open()"
      >
        助手
      </DtButton>
      <div v-else class="ai-dock__panel">
        <AiAssistantPanel
          :surface-kind="surfaceKind"
          :surface-label="surfaceLabel"
          :session-id="ai.sessionId.value"
          :hint="hint"
          @close="ai.close"
        />
      </div>
    </div>
  </PermGuard>
</template>

<style scoped lang="scss">
.ai-dock {
  position: fixed;
  right: 1rem;
  bottom: 1rem;
  z-index: var(--z-assistant);
}

.ai-dock__panel {
  width: min(26rem, calc(100vw - 2rem));
  height: min(34rem, calc(100vh - 6rem));
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: var(--fx-shadow-menu);
}
</style>
