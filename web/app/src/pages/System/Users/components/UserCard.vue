<script setup lang="ts">
/**
 * @fileoverview 用户卡：身份区 + 四条事实 + 底部六个操作。卡片视图专用，
 * 表格仍走 COLUMNS。卡片只转发事件，写操作的逻辑全在页面上。
 */
import { computed } from 'vue'
import type { UserListItem } from '@dt/contracts'
import { DtCard, DtTag } from '@dt/ui'

import { formatDateTime } from '@/utils/datetime'
import { INACTIVE_CARD_VARS } from '../../components/cardVars'
import DirectGrantTag from './DirectGrantTag.vue'
import UserRowActions from './UserRowActions.vue'

const props = defineProps<{ user: UserListItem }>()

const emit = defineEmits<{
  edit: [user: UserListItem]
  'toggle-active': [user: UserListItem]
  'reset-password': [user: UserListItem]
  'assign-role': [user: UserListItem]
  'set-permissions': [user: UserListItem]
  remove: [user: UserListItem]
}>()

/** 停用的账号整卡下沉，与路由规则页的停用规则共用同一套变量。 */
const cardStyle = computed(() =>
  props.user.is_active ? undefined : INACTIVE_CARD_VARS,
)
</script>

<template>
  <DtCard padding="sm" class="user-card flex flex-col" :style="cardStyle">
    <template #header>
      <!-- ⚠ w-full 不能省：.dt-card__hd 自己就是 space-between 的 flex，
           单个子项撑不满，状态标签会贴在标题旁边而不是右边 -->
      <div class="flex w-full min-w-0 items-start justify-between gap-2">
        <div class="min-w-0">
          <h2
            class="m-0 truncate font-display text-sm font-semibold text-text-title"
            :title="props.user.username"
          >
            {{ props.user.username }}
          </h2>
          <p class="m-0 truncate text-2xs text-text-disabled">
            {{ props.user.full_name || '未填写姓名' }}
          </p>
        </div>
        <DtTag
          class="shrink-0"
          size="md"
          :intent="props.user.is_active ? 'success' : 'danger'"
        >
          {{ props.user.is_active ? '已启用' : '已停用' }}
        </DtTag>
      </div>
    </template>

    <div class="flex flex-1 flex-col gap-3">
      <!-- 四格永远全渲染：缺席也占位，两张卡才不会一高一矮 -->
      <dl class="m-0 grid grid-cols-2 gap-x-4 gap-y-2">
        <div class="min-w-0">
          <dt class="text-3xs text-text-disabled">角色</dt>
          <dd class="m-0 mt-1 min-w-0 truncate">
            <DtTag :intent="props.user.role.is_builtin ? 'primary' : 'neutral'">
              {{ props.user.role.name }}
            </DtTag>
          </dd>
        </div>
        <div class="min-w-0">
          <dt class="text-3xs text-text-disabled">直权</dt>
          <dd class="m-0 mt-1">
            <DirectGrantTag :count="props.user.direct_permission_count" />
          </dd>
        </div>
        <div class="min-w-0">
          <dt class="text-3xs text-text-disabled">邮箱</dt>
          <dd
            class="m-0 mt-1 truncate text-xs text-text-secondary"
            :title="props.user.email"
          >
            {{ props.user.email }}
          </dd>
        </div>
        <div class="min-w-0">
          <dt class="text-3xs text-text-disabled">最近登录</dt>
          <dd
            class="m-0 mt-1 text-xs"
            :class="
              props.user.last_login_at === null
                ? 'text-text-disabled'
                : 'font-mono text-text-secondary'
            "
          >
            {{ formatDateTime(props.user.last_login_at, '从未登录') }}
          </dd>
        </div>
      </dl>

      <!-- 分隔线挂在操作区自己身上：一个动作都够不着时它整条不进 DOM，
           卡底才不会剩一条空横线 -->
      <UserRowActions
        class="mt-auto border-t border-border-subtle pt-2"
        :user="props.user"
        @edit="emit('edit', $event)"
        @toggle-active="emit('toggle-active', $event)"
        @reset-password="emit('reset-password', $event)"
        @assign-role="emit('assign-role', $event)"
        @set-permissions="emit('set-permissions', $event)"
        @remove="emit('remove', $event)"
      />
    </div>
  </DtCard>
</template>
