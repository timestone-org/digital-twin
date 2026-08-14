<script setup lang="ts">
/**
 * @fileoverview 台账行上的操作入口，表格单元格与卡片共用。
 * ⚠ 两档权限分开挡：看数据只要 `ac:view`，改档案要 `ac:manage`。整条挡在
 * `ac:manage` 下会让只读账号连数据都点不进去。
 * ⚠ class 要显式落到最外层 div 上——PermGuard 渲染的是插槽 fragment，
 * 自动透传落不下来。
 */
import { RouterLink } from 'vue-router'
import type { AcUnit } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtIcon } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'

const props = defineProps<{ unit: AcUnit }>()

const emit = defineEmits<{
  edit: [unit: AcUnit]
  configure: [unit: AcUnit]
  remove: [unit: AcUnit]
}>()

defineOptions({ inheritAttrs: false })
</script>

<template>
  <div v-bind="$attrs" class="flex items-center justify-end gap-1">
    <!-- ⚠ 无权限时按钮**不存在于 DOM**，不是禁用：禁用态等于告诉人
       「这里有个你够不着的东西」。真正的拦截在后端。 -->
    <PermGuard :codes="[PERMISSION_CODES.acView]">
      <!-- ⚠ 用 RouterLink 而不是按钮：它是导航，地址会变；中键新标签打开与
         复制链接都该照常可用，换成按钮就把这些全丢了。 -->
      <RouterLink
        :to="`/hvac/ac-units/${props.unit.id}/data`"
        class="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-accent-primary/10 hover:text-text-primary"
        aria-label="查看数据"
        title="查看数据"
      >
        <DtIcon name="activity" :size="16" />
      </RouterLink>
    </PermGuard>

    <PermGuard :codes="[PERMISSION_CODES.acManage]">
      <DtButton
        variant="ghost"
        intent="neutral"
        size="sm"
        icon="pencil"
        aria-label="编辑空调"
        title="编辑空调"
        @click="emit('edit', props.unit)"
      />
      <DtButton
        variant="ghost"
        intent="neutral"
        size="sm"
        icon="settings"
        aria-label="数据与达标"
        title="数据与达标"
        @click="emit('configure', props.unit)"
      />
      <DtButton
        variant="ghost"
        intent="danger"
        size="sm"
        icon="trash"
        aria-label="删除空调"
        title="删除空调"
        @click="emit('remove', props.unit)"
      />
    </PermGuard>
  </div>
</template>
