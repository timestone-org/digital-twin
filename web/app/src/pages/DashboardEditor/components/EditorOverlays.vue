<script setup lang="ts">
/**
 * @fileoverview 编辑器的浮层：挑点弹窗、快捷键帮助、全屏预览、画布右键菜单，
 * 外加助手面板。只做转发；开关状态归页面持有。
 *
 * ⚠ 助手压在 dropdown 之上、modal 之下（`--z-assistant`）：它是常驻的工作面
 * 而不是弹窗，挑点弹窗这类业务浮层仍要能盖住它。
 */
import type { DashboardNodePayload } from '@dt/contracts'
import type { DesignSize, GetModuleManifest } from '@dt/runtime'

import type { CollectPoint } from '@dt/contracts'
import type { ContextMenuAction } from '../scripts/contextMenuItems'
import type { ContextMenuState } from '../scripts/useEditorContextMenu'
import PointPickerDialog from '@/components/binding/PointPickerDialog.vue'
import AiAssistantPanel from '@/components/ai/AiAssistantPanel.vue'
import PermGuard from '@/components/PermGuard.vue'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton } from '@dt/ui'
import type { AiPanel } from '../scripts/useAiPanel'
import CanvasContextMenu from './CanvasContextMenu.vue'
import EditorPreview from './EditorPreview.vue'
import ShortcutsDialog from './ShortcutsDialog.vue'

defineProps<{
  pickingFieldKey: string | null
  helpOpen: boolean
  previewOpen: boolean
  nodes: readonly DashboardNodePayload[]
  design: DesignSize
  getManifest: GetModuleManifest
  chromeJson: Record<string, unknown>
  contextMenu: ContextMenuState | null
  ai: AiPanel
}>()

const emit = defineEmits<{
  'close-picker': [open: boolean]
  pick: [point: CollectPoint]
  'update:helpOpen': [open: boolean]
  'close-preview': []
  'menu-pick': [action: ContextMenuAction]
  'close-menu': []
}>()
</script>

<template>
  <PointPickerDialog
    :model-value="pickingFieldKey !== null"
    :field-key="pickingFieldKey"
    @update:model-value="emit('close-picker', $event)"
    @pick="emit('pick', $event)"
  />
  <ShortcutsDialog
    :open="helpOpen"
    @update:open="emit('update:helpOpen', $event)"
  />
  <EditorPreview
    v-if="previewOpen"
    :nodes="nodes"
    :design="design"
    :get-manifest="getManifest"
    :chrome-json="chromeJson"
    @close="emit('close-preview')"
  />
  <CanvasContextMenu
    :menu="contextMenu"
    @pick="emit('menu-pick', $event)"
    @close="emit('close-menu')"
  />

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
          surface-kind="dashboard-editor"
          surface-label="大屏编辑器"
          :session-id="ai.sessionId.value"
          hint="助手改的是草稿，保存要你自己按。"
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
