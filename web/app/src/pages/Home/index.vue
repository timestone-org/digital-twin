<script setup lang="ts">
/**
 * @fileoverview 登录后的落地页：这个会话是谁、有什么权限、能进哪里。
 * 业务模块（大屏、点位、台账）接入后在 `navItems.ts` 加项，快捷入口自动跟上。
 */
import { computed, onMounted } from 'vue'

import { AppShell } from '@/components/layout'
import { useAuthStore } from '@/stores/auth'
import IdentityCard from './components/IdentityCard.vue'
import PermissionCard from './components/PermissionCard.vue'
import QuickEntries from './components/QuickEntries.vue'

const auth = useAuthStore()

const roleCodes = computed(() => auth.user?.role_permissions ?? [])
const directCodes = computed(() => auth.user?.direct_permissions ?? [])

const stats = computed(() => [
  { key: 'total', label: '有效权限码', value: auth.permissions.size },
  { key: 'role', label: '来自角色', value: roleCodes.value.length },
  { key: 'direct', label: '单独授予', value: directCodes.value.length },
])

// 权限可能在别处被改过，进页面时对齐一次；失败静默，不阻断渲染
onMounted(() => {
  void auth.syncMe()
})
</script>

<template>
  <AppShell title="工作台" subtitle="身份与权限概览">
    <!-- main 不滚了，这一页自己吃满高度并在内部滚 -->
    <div class="flex h-full min-h-0 flex-col gap-5 overflow-y-auto pr-1">
      <IdentityCard :user="auth.user" />

      <div class="grid gap-5 lg:grid-cols-2">
        <PermissionCard
          :stats="stats"
          :role-name="auth.user?.role?.name ?? '—'"
          :role-codes="roleCodes"
          :direct-codes="directCodes"
        />

        <QuickEntries />
      </div>
    </div>
  </AppShell>
</template>
