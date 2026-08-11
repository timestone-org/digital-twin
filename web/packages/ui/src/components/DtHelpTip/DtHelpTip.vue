<script setup lang="ts">
/**
 * @fileoverview DtHelpTip —— 标签旁的问号气泡，装一段成句的说明。
 * ⚠ 与 DtTooltip 的分工：这个是点开的，所以内容可以长、可以选中复制；
 * 一句话的短提示用 DtTooltip，别让用户为了看一行字先点一下。
 */
import type { DtOverlaySide } from '../../overlay/placement'
import DtIcon from '../DtIcon/DtIcon.vue'
import DtPopover from '../DtPopover/DtPopover.vue'

withDefaults(
  defineProps<{
    text: string
    /** 无障碍名称，缺省「说明」。同一页有多个时给各自的字段名更好认。 */
    label?: string
    side?: DtOverlaySide
  }>(),
  { label: '说明', side: 'top' },
)
</script>

<template>
  <DtPopover class="dt-help-tip" :side="side">
    <template #default="{ toggle, isOpen, panelId }">
      <button
        type="button"
        class="dt-help-tip__button"
        :aria-label="label"
        aria-haspopup="dialog"
        :aria-expanded="isOpen"
        :aria-controls="panelId"
        @click="toggle"
      >
        <DtIcon name="circle-question" :size="14" />
      </button>
    </template>
    <template #content>
      <p class="dt-help-tip__text">{{ text }}</p>
    </template>
  </DtPopover>
</template>

<style scoped lang="scss">
@use '../../styles/control' as ctl;

.dt-help-tip {
  vertical-align: middle;

  &__button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-disabled);
    cursor: pointer;
    transition: color 0.18s ease;

    &:hover {
      color: var(--accent-primary);
    }

    @include ctl.focus-ring;
  }

  &__text {
    margin: 0;
    color: var(--text-secondary);
  }
}

@include ctl.reduced-motion {
  .dt-help-tip__button {
    transition: none;
  }
}
</style>
