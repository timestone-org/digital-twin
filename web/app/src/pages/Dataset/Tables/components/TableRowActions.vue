<script setup lang="ts">
/**
 * @fileoverview 台账行上的操作入口，表格单元格与卡片共用。
 *
 * ⚠ 改与删同为 `dataset:manage`（后端两处同码），故整组一起藏；无权限时按钮
 * **不存在于 DOM**，不是禁用——禁用态等于告诉人「这里有个你够不着的东西」。
 * ⚠ 行内不开 `explain`：每行挂一句「只读」是纯噪音，页面顶上那一句已经说清了。
 * ⚠ class 要显式落到最外层 div 上——PermGuard 渲染的是插槽 fragment，
 * 自动透传落不下来。
 */
import type { DatasetTableSummary } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'

const props = defineProps<{ table: DatasetTableSummary }>()

const emit = defineEmits<{
  edit: [table: DatasetTableSummary]
  remove: [table: DatasetTableSummary]
}>()

defineOptions({ inheritAttrs: false })
</script>

<template>
  <div v-bind="$attrs" class="flex items-center justify-end gap-1">
    <PermGuard :codes="[PERMISSION_CODES.datasetManage]">
      <DtButton
        variant="ghost"
        intent="neutral"
        size="sm"
        icon="pencil"
        aria-label="编辑台账"
        title="编辑台账"
        @click="emit('edit', props.table)"
      />
      <DtButton
        variant="ghost"
        intent="danger"
        size="sm"
        icon="trash"
        aria-label="删除台账"
        title="删除台账"
        @click="emit('remove', props.table)"
      />
    </PermGuard>
  </div>
</template>
