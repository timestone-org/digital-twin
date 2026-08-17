<script setup lang="ts">
/**
 * @fileoverview 一条绑定「指向哪个点位」的那一行：显示当前点位身份 + 一个挑点按钮。
 * 实时点位与历史序列两种来源把点位身份存在不同字段上，但这一行的样子完全相同，
 * 故只留一份；差异由调用方传进来的 `nodeKey` 与写回路径承担。
 */
import { DtButton, DtTag } from '@dt/ui'

defineProps<{
  /** 当前指向的点位身份；空串 = 还没挑。 */
  nodeKey: string
}>()

const emit = defineEmits<{ pick: [] }>()
</script>

<template>
  <div class="flex items-center gap-2">
    <DtTag v-if="nodeKey !== ''" size="sm" intent="info">{{ nodeKey }}</DtTag>
    <span v-else class="text-2xs text-text-disabled">还没挑点位</span>
    <DtButton size="sm" variant="outline" icon="search" @click="emit('pick')">
      挑点位
    </DtButton>
  </div>
</template>
