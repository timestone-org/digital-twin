<script setup lang="ts">
/**
 * @fileoverview 台账行上的操作入口，表格单元格与卡片共用。
 * ⚠ 整条操作区在不在由它自己判：外层 PermGuard 一挡，调用方挂上来的分隔线
 * 也跟着消失。因此 class 要显式落到内层 div 上——PermGuard 渲染的是插槽
 * fragment，自动透传落不下来。
 */
import type { AcUnit } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton } from '@dt/ui'

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
  <PermGuard :codes="[PERMISSION_CODES.acManage]">
    <div v-bind="$attrs" class="flex items-center justify-end gap-1">
      <!-- ⚠ 无权限时按钮**不存在于 DOM**，不是禁用：禁用态等于告诉人
         「这里有个你够不着的东西」。真正的拦截在后端。 -->
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
    </div>
  </PermGuard>
</template>
