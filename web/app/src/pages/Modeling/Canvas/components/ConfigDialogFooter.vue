<script setup lang="ts">
/** @fileoverview 算子配置的独立状态区与完成操作，正文草稿不随状态重绘。 */
import { DtButton } from '@dt/ui'
import type { Ref } from 'vue'
import type { ConfigStatus } from '../scripts/configValues'

const props = defineProps<{
  state: { status: Ref<ConfigStatus> }
  isReadonly: boolean
}>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <div class="dt-ml-dialog-footer">
    <p
      :class="{
        'dt-ml-dialog-footer__warning': props.state.status.value.message,
      }"
      role="status"
    >
      {{
        props.isReadonly
          ? '只读模式：可查看配置。'
          : props.state.status.value.message ||
            '参数已更新到画布草稿；保存流水线后生效。'
      }}
    </p>
    <DtButton
      :disabled="props.state.status.value.hasDraft"
      @click="emit('close')"
    >
      {{ props.isReadonly ? '关闭' : '完成配置' }}
    </DtButton>
  </div>
</template>

<style scoped lang="scss">
.dt-ml-dialog-footer {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  min-width: 0;
  p {
    flex: 1;
    min-width: min(100%, 15rem);
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--font-size-compact);
    overflow-wrap: anywhere;
  }
  p.dt-ml-dialog-footer__warning {
    color: var(--state-warning);
  }
}
</style>
