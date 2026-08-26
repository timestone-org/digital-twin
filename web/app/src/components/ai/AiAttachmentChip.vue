<script setup lang="ts">
/**
 * @fileoverview 输入框里的一条待发附件：名字、概况、可展开的全文、移除。
 * 点开全文是这条链的要点——用户发出去前能核对助手将要看到什么。
 */
import { DtButton, DtIcon } from '@dt/ui'

import type { PendingAttachment } from '@/features/ai/attachment'

defineProps<{
  attachment: PendingAttachment
  /** 全文此刻是不是摊开着。开合由外面记，同屏只摊开一条。 */
  expanded: boolean
}>()

const emit = defineEmits<{ toggle: []; remove: [] }>()
</script>

<template>
  <li class="ai-file">
    <div class="ai-file__row">
      <button
        type="button"
        class="ai-file__head"
        :aria-expanded="expanded"
        @click="emit('toggle')"
      >
        <DtIcon name="paperclip" :size="13" class="ai-file__clip" />
        <span class="ai-file__name">{{ attachment.name }}</span>
        <span class="ai-file__meta">{{ attachment.meta }}</span>
      </button>
      <DtButton
        variant="ghost"
        size="xs"
        icon="close"
        :aria-label="`移除附件 ${attachment.name}`"
        @click="emit('remove')"
      />
    </div>
    <pre v-if="expanded" class="ai-file__preview">{{ attachment.text }}</pre>
  </li>
</template>

<style scoped lang="scss">
.ai-file__row {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.ai-file__head {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 0.375rem;
  min-width: 0;
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-panel);
  color: var(--text-secondary);
  font: inherit;
  font-size: 0.75rem;
  text-align: left;
  cursor: pointer;
}

.ai-file__head:hover {
  border-color: var(--border-hover);
  color: var(--text-primary);
}

.ai-file__clip {
  flex: none;
  color: var(--accent-on-surface);
}

.ai-file__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}

.ai-file__meta {
  flex: none;
  margin-left: auto;
  color: var(--text-disabled);
  font-size: 0.6875rem;
}

/* 附件全文：用户发出去前能核对助手将要看到什么 */
.ai-file__preview {
  max-height: 9rem;
  margin: 0.25rem 0 0;
  padding: 0.375rem 0.5rem;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  overflow: auto;
  background: var(--surface-panel);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
