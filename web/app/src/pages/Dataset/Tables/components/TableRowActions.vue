<script setup lang="ts">
/**
 * @fileoverview 台账行上的操作入口，表格单元格与卡片共用。
 *
 * ⚠ 打开详情不挂 PermGuard：它去的那条路由与本页同挂 `dataset:view`，站在这
 * 张列表上的账号必然已经有这个码，再挡一次只会藏掉一个本该点得着的入口。
 * ⚠ 改与删同为 `dataset:manage`（后端两处同码），故整组一起藏；无权限时按钮
 * **不存在于 DOM**，不是禁用——禁用态等于告诉人「这里有个你够不着的东西」。
 * ⚠ 行内不开 `explain`：每行挂一句「只读」是纯噪音，页面顶上那一句已经说清了。
 * ⚠ class 要显式落到最外层 div 上——PermGuard 渲染的是插槽 fragment，
 * 自动透传落不下来。
 */
import { RouterLink } from 'vue-router'
import type { DatasetTableSummary } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtIcon } from '@dt/ui'

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
    <!-- ⚠ 用 RouterLink 而不是按钮：它是导航，地址会变；中键新标签打开与
       复制链接都该照常可用，换成按钮就把这些全丢了。 -->
    <RouterLink
      :to="`/datasets/${props.table.id}`"
      class="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-accent-primary/10 hover:text-text-primary"
      aria-label="配置列与查看数据"
      title="配置列与查看数据"
    >
      <DtIcon name="list-checks" :size="16" />
    </RouterLink>

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
