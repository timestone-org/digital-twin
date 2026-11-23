<script setup lang="ts">
/** @fileoverview 个人资料页的账号概览，展示当前会话的身份、角色与状态。 */
import { computed } from 'vue'
import type { AuthUser } from '@dt/contracts'
import { DtCard, DtTag } from '@dt/ui'

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
  <DtCard class="grid gap-4 lg:grid-cols-2 lg:items-center">
    <div class="flex min-w-0 items-center gap-3">
      <span
        class="grid size-12 shrink-0 place-items-center rounded-full border border-border-default bg-surface-raised text-lg font-semibold text-accent-on-surface"
        aria-hidden="true"
      >
        {{ initial }}
      </span>
      <div class="min-w-0">
        <h2
          class="font-display m-0 text-lg font-semibold break-words text-text-title"
        >
          {{ user?.full_name || user?.username || '未登录' }}
        </h2>
        <div v-if="user" class="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span
            v-if="user.full_name"
            class="font-mono mr-1 min-w-0 text-xs break-words text-text-secondary"
          >
            {{ user.username }}
          </span>
          <DtTag intent="primary">{{ user.role.name }}</DtTag>
          <DtTag :intent="user.is_active ? 'success' : 'danger'">
            {{ user.is_active ? '已启用' : '已停用' }}
          </DtTag>
        </div>
        <p
          v-if="user?.role.description"
          class="m-0 mt-1.5 text-xs break-words text-text-secondary"
        >
          {{ user.role.description }}
        </p>
      </div>
    </div>

    <dl class="m-0 grid grid-cols-2 gap-x-4 gap-y-2" aria-label="账号信息">
      <div v-for="field in fields" :key="field.key" class="min-w-0">
        <dt class="m-0 text-2xs text-text-disabled">{{ field.label }}</dt>
        <dd class="m-0 mt-0.5 text-xs break-words text-text-secondary">
          {{ field.value }}
        </dd>
      </div>
    </dl>
  </DtCard>
</template>
