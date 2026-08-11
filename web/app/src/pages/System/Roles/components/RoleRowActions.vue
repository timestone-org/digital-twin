<script setup lang="ts">
/**
 * @fileoverview 角色行上的四个入口，表格单元格与卡片共用同一个它。
 *
 * ⚠ 入口一律存在，可达性不由 `is_builtin` 决定——它只决定打开后是可写还是
 * 只读。删除是唯一的例外：内置角色的删除后端无条件拒绝，且没有替代路径。
 */
import { computed } from 'vue'
import type { RoleSummary } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'

const props = defineProps<{ role: RoleSummary }>()

const emit = defineEmits<{
  edit: [role: RoleSummary]
  codes: [role: RoleSummary]
  clone: [role: RoleSummary]
  remove: [role: RoleSummary]
}>()

const codesLabel = computed(() =>
  props.role.is_builtin ? '查看权限' : '设置权限',
)
const codesTitle = computed(() =>
  props.role.is_builtin ? '查看权限（内置角色由种子维护）' : '设置权限',
)
</script>

<template>
  <div class="flex items-center justify-end gap-1">
    <!-- ⚠ 不包 PermGuard：行上本就把全部码铺出来了，打开只是把同一份数据
         按分组排版；而只读账号恰恰最需要这个视图。能不能改由弹窗自己判。 -->
    <DtButton
      variant="ghost"
      intent="neutral"
      size="sm"
      icon="list-checks"
      :aria-label="codesLabel"
      :title="codesTitle"
      @click="emit('codes', props.role)"
    />
    <PermGuard :codes="[PERMISSION_CODES.roleManage]">
      <DtButton
        variant="ghost"
        intent="neutral"
        size="sm"
        icon="plus"
        aria-label="以此为模板新建角色"
        title="以此为模板新建角色"
        @click="emit('clone', props.role)"
      />
      <DtButton
        variant="ghost"
        intent="neutral"
        size="sm"
        icon="pencil"
        aria-label="编辑角色"
        title="编辑角色"
        @click="emit('edit', props.role)"
      />
      <DtButton
        v-if="!props.role.is_builtin"
        variant="ghost"
        intent="danger"
        size="sm"
        icon="trash"
        aria-label="删除角色"
        title="删除角色"
        @click="emit('remove', props.role)"
      />
    </PermGuard>
  </div>
</template>
