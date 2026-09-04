<script setup lang="ts">
/**
 * @fileoverview 认不出的那一路摘要：说明放第一行，原文折在下面，永不白屏。
 *
 * ⚠ 摘要撑爆字节预算时后端把这一路换成 `{kind, note}` 的桩，那时「没有可看的」
 * 与「这一步没算出东西」是两回事，摆空态会把前者说成后者。
 */
import { computed } from 'vue'

const props = defineProps<{
  /** 后端给的说明；空串时给一句照实的兜底。 */
  note: string
  /** 这一路摘要的原文。 */
  raw: Record<string, unknown>
}>()

const DEFAULT_NOTE = '这一路的结果认不出是什么形状，下面是它的原文。'

const text = computed(() => props.note || DEFAULT_NOTE)
const raw = computed(() => JSON.stringify(props.raw, null, 2))
</script>

<template>
  <div class="dt-ml-rawview">
    <p class="dt-ml-rawview__note">{{ text }}</p>
    <details class="dt-ml-rawview__more">
      <summary>原始摘要</summary>
      <pre class="dt-ml-rawview__raw">{{ raw }}</pre>
    </details>
  </div>
</template>

<style scoped lang="scss">
.dt-ml-rawview {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;

  &__note {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--ctl-hint-fs-lg);
  }

  &__more {
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }

  &__raw {
    max-height: 18rem;
    margin: 0.5rem 0 0;
    overflow: auto;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
    white-space: pre-wrap;
    word-break: break-all;
  }
}
</style>
