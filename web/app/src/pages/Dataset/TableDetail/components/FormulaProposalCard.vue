<script setup lang="ts">
/**
 * @fileoverview 助手交上来、等用户点头的一条公式。
 *
 * ⚠ 这张卡是台账页与大屏编辑器的分界：那边助手直接改草稿（一次 Ctrl+Z 撤得掉），
 * 这边**每一次写入都是真实落库、没有撤销栈**，所以最后那一下必须由人来按。
 * 「填进编辑器」也只是把表达式带进弹窗，保存仍是用户自己点。
 */
import { DtButton, DtTag } from '@dt/ui'

import type { FormulaProposal } from '../scripts/aiSurface'

defineProps<{ proposal: FormulaProposal }>()

const emit = defineEmits<{ adopt: []; dismiss: [] }>()
</script>

<template>
  <div class="proposal">
    <div class="proposal__head">
      <span class="proposal__title">助手的公式提议</span>
      <DtTag :tone="proposal.isExisting ? 'info' : 'warning'" size="sm">
        {{ proposal.isExisting ? '改现有列' : '新建一列' }}
      </DtTag>
    </div>
    <p class="proposal__column">{{ proposal.columnKey }}</p>
    <code class="proposal__formula">{{ proposal.formula }}</code>
    <p class="proposal__reading">{{ proposal.reading }}</p>
    <div class="proposal__actions">
      <DtButton variant="ghost" size="sm" @click="emit('dismiss')">
        不用
      </DtButton>
      <DtButton variant="solid" size="sm" @click="emit('adopt')">
        填进编辑器
      </DtButton>
    </div>
  </div>
</template>

<style scoped lang="scss">
.proposal {
  position: fixed;
  right: 1rem;
  bottom: 4rem;
  z-index: var(--z-assistant);
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(26rem, calc(100vw - 2rem));
  padding: 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  background: var(--surface-raised);
  box-shadow: var(--fx-shadow-menu);
}

.proposal__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.proposal__title {
  font-weight: 600;
  color: var(--text-primary);
}

.proposal__column {
  color: var(--text-secondary);
  font-size: 0.8125rem;
}

.proposal__formula {
  padding: 8px;
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  word-break: break-all;
}

.proposal__reading {
  color: var(--text-secondary);
  font-size: 0.8125rem;
}

.proposal__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
