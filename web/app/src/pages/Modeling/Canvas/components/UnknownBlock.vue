<script setup lang="ts">
/**
 * @fileoverview 还没有专门画法的块的兜底：照实说明 + 折叠原文，永不白屏。
 *
 * ⚠ 兜底不是空态：块里的数是后端真算出来的，不给画法也要能看见原文，
 * 否则「这一块没画出来」与「这一步什么都没算」在界面上长得一模一样。
 */
import { computed } from 'vue'

import type { ReportBlock } from '../scripts/reportBlocks'
import { isBlockKind } from '../scripts/reportBlocks'

const props = defineProps<{ block: ReportBlock }>()

// 两句话分开：一句是「还没画」，另一句是「不认识」，前者等下一批画法，
// 后者说明这一侧的花名册落后于后端
const NOT_DRAWN = '这一块还没有专门的画法，先照实列出它的内容。'
const UNKNOWN_KIND = '这一块的种类认不出来，先照实列出它的内容。'

const note = computed(() =>
  isBlockKind(props.block.kind) ? NOT_DRAWN : UNKNOWN_KIND,
)

const raw = computed(() => JSON.stringify(props.block.payload, null, 2))
</script>

<template>
  <div class="dt-ml-rawblock">
    <p class="dt-ml-rawblock__title">{{ props.block.title }}</p>
    <p class="dt-ml-rawblock__note">{{ note }}</p>
    <details class="dt-ml-rawblock__more">
      <summary>原始内容</summary>
      <pre class="dt-ml-rawblock__raw">{{ raw }}</pre>
    </details>
  </div>
</template>

<style scoped lang="scss">
.dt-ml-rawblock {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.75rem;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-raised);

  &__title {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--ctl-hint-fs-md);
    font-weight: 600;
  }

  &__note {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }

  &__more {
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }

  &__raw {
    max-height: 14rem;
    margin: 0.5rem 0 0;
    overflow: auto;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
    white-space: pre-wrap;
    word-break: break-all;
  }
}
</style>
