<script setup lang="ts">
/**
 * @fileoverview 用户行上的六个操作入口。抽出来是为了让页面主体读得下去，
 * 顺带把「哪个动作要哪个码」集中成一份。
 */
import type { UserListItem } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'

const props = defineProps<{ user: UserListItem }>()

const emit = defineEmits<{
  edit: [user: UserListItem]
  'toggle-active': [user: UserListItem]
  'reset-password': [user: UserListItem]
  'assign-role': [user: UserListItem]
  'set-permissions': [user: UserListItem]
  remove: [user: UserListItem]
}>()
</script>

<template>
  <div class="flex items-center justify-end gap-1">
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
</template>
