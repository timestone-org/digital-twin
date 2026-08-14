<script setup lang="ts">
/**
 * @fileoverview 编辑器顶部的三条通知：版本冲突、加载失败、孤儿节点计数。
 * 冲突与失败互斥（冲突优先），孤儿提示独立叠加。
 */
import { DtNotice } from '@dt/ui'

defineProps<{
  conflict: string | null
  error: string | null
  detachedCount: number
}>()
</script>

<template>
  <DtNotice v-if="conflict" intent="danger" icon="alert-triangle">
    {{ conflict }}
  </DtNotice>
  <DtNotice v-else-if="error" intent="danger" icon="alert-circle">
    {{ error }}
  </DtNotice>
  <DtNotice v-if="detachedCount > 0" intent="warning" icon="alert-triangle">
    有 {{ detachedCount }} 个节点的父节点不存在，它们不会被画出来。
  </DtNotice>
</template>
