<script setup lang="ts">
/**
 * @fileoverview 用户行上的六个操作入口，表格单元格与卡片共用。
 * ⚠ 整条操作区在不在由它自己判：外层 PermGuard 一挡，调用方挂上来的分隔线
 * 也跟着消失。因此 class 要显式落到内层 div 上——PermGuard 渲染的是插槽
 * fragment，自动透传落不下来。
 */
import type { UserListItem } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'

// 六个动作合起来要的码：一个都够不着就整条不渲染
const ANY_ACTION_CODES: readonly string[] = [
  PERMISSION_CODES.userManage,
  PERMISSION_CODES.userGrant,
  PERMISSION_CODES.userDelete,
]

const props = defineProps<{ user: UserListItem }>()

const emit = defineEmits<{
  edit: [user: UserListItem]
  'toggle-active': [user: UserListItem]
  'reset-password': [user: UserListItem]
  'assign-role': [user: UserListItem]
  'set-permissions': [user: UserListItem]
  remove: [user: UserListItem]
}>()

defineOptions({ inheritAttrs: false })
</script>

<template>
  <PermGuard :codes="ANY_ACTION_CODES" mode="any">
    <div v-bind="$attrs" class="flex items-center justify-end gap-1">
      <!-- ⚠ 无权限时按钮**不存在于 DOM**，不是禁用：禁用态等于告诉人
         「这里有个你够不着的东西」。真正的拦截在后端。 -->
      <PermGuard :codes="[PERMISSION_CODES.userManage]">
        <DtButton
          variant="ghost"
          intent="neutral"
          size="sm"
          icon="pencil"
          aria-label="编辑资料"
          title="编辑资料"
          @click="emit('edit', props.user)"
        />
        <DtButton
          variant="ghost"
          intent="neutral"
          size="sm"
          :icon="props.user.is_active ? 'toggle-right' : 'toggle-left'"
          :aria-label="props.user.is_active ? '停用' : '启用'"
          :title="props.user.is_active ? '停用' : '启用'"
          @click="emit('toggle-active', props.user)"
        />
        <DtButton
          variant="ghost"
          intent="neutral"
          size="sm"
          icon="key-round"
          aria-label="重置密码"
          title="重置密码"
          @click="emit('reset-password', props.user)"
        />
      </PermGuard>
      <PermGuard :codes="[PERMISSION_CODES.userGrant]">
        <DtButton
          variant="ghost"
          intent="neutral"
          size="sm"
          icon="shield-check"
          aria-label="改派角色"
          title="改派角色"
          @click="emit('assign-role', props.user)"
        />
        <DtButton
          variant="ghost"
          intent="neutral"
          size="sm"
          icon="list-checks"
          aria-label="设置直权"
          title="设置直权"
          @click="emit('set-permissions', props.user)"
        />
      </PermGuard>
      <PermGuard :codes="[PERMISSION_CODES.userDelete]">
        <DtButton
          variant="ghost"
          intent="danger"
          size="sm"
          icon="trash"
          aria-label="删除"
          title="删除"
          @click="emit('remove', props.user)"
        />
      </PermGuard>
    </div>
  </PermGuard>
</template>
