<script setup lang="ts">
/**
 * @fileoverview 登录后的落地页：这个会话是谁、有什么权限、能进哪里。
 * 业务模块（大屏、点位、台账）接入后在 `navItems.ts` 加项，快捷入口自动跟上。
 */
import { computed, onMounted } from 'vue'
import { DtCard, DtTag } from '@dt/ui'

import { AppShell } from '@/components/layout'
import { useAuthStore } from '@/stores/auth'
import IdentityCard from './components/IdentityCard.vue'
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
        <DtCard title="我的权限" icon="key-round" corners>
          <dl class="mb-4 grid grid-cols-3 gap-3" aria-label="权限计数">
            <div
              v-for="stat in stats"
              :key="stat.key"
              class="rounded-md border border-border-subtle bg-surface-sunken px-3 py-2"
            >
              <dd
                class="font-display m-0 text-xl font-semibold text-accent-secondary"
              >
                {{ stat.value }}
              </dd>
              <dt class="m-0 text-2xs text-text-disabled">{{ stat.label }}</dt>
            </div>
          </dl>

          <p class="m-0 mb-2 text-[13px] leading-relaxed text-text-secondary">
            角色权限来自
            <strong class="font-medium text-text-primary">
              {{ auth.user?.role?.name ?? '—' }}
            </strong>
            ，单独授予的直权叠加在它之上。
          </p>

          <div class="flex flex-wrap gap-1.5">
            <DtTag v-for="code in roleCodes" :key="`role-${code}`" mono>
              {{ code }}
            </DtTag>
            <DtTag
              v-for="code in directCodes"
              :key="`direct-${code}`"
              intent="primary"
              mono
            >
              {{ code }}
            </DtTag>
            <span
              v-if="auth.permissions.size === 0"
              class="text-[13px] text-text-disabled"
            >
              当前账号没有任何权限码
            </span>
          </div>

          <p
            v-if="directCodes.length"
            class="m-0 mt-3 text-2xs text-text-disabled"
          >
            高亮的是直权：它绕过角色单独授予，改派角色也带不走。
          </p>
        </DtCard>

        <QuickEntries />
      </div>
    </div>
  </AppShell>
</template>
