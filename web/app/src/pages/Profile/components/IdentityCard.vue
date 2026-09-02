<script setup lang="ts">
/**
 * @fileoverview 工作台顶部的身份卡：这个会话现在是谁、以什么角色、状态如何。
 *
 * ⚠ 展示的是**本地会话缓存**里的 user，可能落后于服务端（别处改了角色或停用）。
 * 页面进入时会 syncMe() 对齐一次，但那之后仍会漂移——所以这里只做展示，
 * 不拿它当任何判定依据。真正的判定在后端的闸 1 与闸 2。
 */
import { computed } from 'vue'
import type { AuthUser } from '@dt/contracts'
import { DtCard, DtIcon, DtTag } from '@dt/ui'

import { formatDateTime } from '@/utils/datetime'

const props = defineProps<{ user: AuthUser | null }>()

const initial = computed(() =>
  (props.user?.full_name || props.user?.username || '?')
    .slice(0, 1)
    .toUpperCase(),
)

const fields = computed(() => [
  { key: 'email', label: '邮箱', value: props.user?.email || '—' },
  { key: 'phone', label: '手机', value: props.user?.phone || '—' },
  {
    key: 'last-login',
    label: '最近登录',
    value: formatDateTime(props.user?.last_login_at ?? null, '本次即首次'),
  },
  {
    key: 'created',
    label: '创建于',
    value: formatDateTime(props.user?.created_at ?? null),
  },
])
</script>

<template>
  <DtCard corners class="flex flex-wrap items-center gap-5">
    <span
      class="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-accent-primary/40 bg-surface-raised text-xl font-semibold text-accent-on-surface"
      aria-hidden="true"
    >
      {{ initial }}
    </span>

    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-2">
        <h2
          class="font-display dt-glow-text m-0 truncate text-lg font-semibold"
        >
          {{ user?.full_name || user?.username || '未登录' }}
        </h2>
        <DtTag v-if="user" intent="primary">{{ user.role.name }}</DtTag>
        <DtTag v-if="user" :intent="user.is_active ? 'success' : 'danger'">
          {{ user.is_active ? '已启用' : '已停用' }}
        </DtTag>
      </div>
      <p class="m-0 mt-1 flex items-center gap-1.5 text-xs text-text-disabled">
        <DtIcon name="user" :size="13" />
        <span class="font-mono">{{ user?.username ?? '—' }}</span>
        <span v-if="user?.role.description">· {{ user.role.description }}</span>
      </p>
    </div>

    <dl
      class="grid grid-cols-2 gap-x-6 gap-y-2 text-xs xl:grid-cols-4"
      aria-label="账号信息"
    >
      <div v-for="field in fields" :key="field.key">
        <dt class="m-0 text-2xs text-text-disabled">{{ field.label }}</dt>
        <dd class="m-0 mt-0.5 truncate text-text-secondary">
          {{ field.value }}
        </dd>
      </div>
    </dl>
  </DtCard>
</template>
