<script setup lang="ts">
/**
 * @fileoverview 工作台的快捷入口。
 *
 * ⚠ 条目从 `NAV_ITEMS` 推导，**不另列一份清单**：另列一份就会和左栏、
 * 和 router 的 meta.permissions 三处漂移，出现「这里点得进、左栏看不见」。
 * 过滤口径同样是「任一即可」，与 AppNavRail 逐字一致。
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { DtCard, DtEmpty, DtIcon } from '@dt/ui'

import {
  NAV_ITEMS,
  navPermissionCodes,
  type NavItem,
} from '@/components/layout'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

/** 拍平成叶子项；工作台自己不列进去。 */
function leaves(item: NavItem): NavItem[] {
  if (item.children?.length) return item.children.flatMap(leaves)
  return item.to !== undefined && item.to !== '/' ? [item] : []
}

const entries = computed(() =>
  NAV_ITEMS.flatMap(leaves).filter((item) => {
    const codes = navPermissionCodes(item)
    return codes.length === 0 || auth.can(codes, 'any')
  }),
)
</script>

<template>
  <DtCard title="快捷入口" icon="layout-grid" corners>
    <div v-if="entries.length" class="grid gap-2 sm:grid-cols-2">
      <RouterLink
        v-for="entry in entries"
        :key="entry.key"
        :to="entry.to ?? '/'"
        class="group flex items-center gap-3 rounded-md border border-border-subtle bg-surface-sunken px-3 py-2.5 text-text-secondary transition-colors hover:border-border-hover hover:text-text-primary"
      >
        <DtIcon :name="entry.icon" :size="17" class="text-accent-primary" />
        <span class="flex-1 truncate text-[13px]">{{ entry.label }}</span>
        <DtIcon
          name="arrow-right"
          :size="14"
          class="text-text-disabled transition-transform group-hover:translate-x-0.5"
        />
      </RouterLink>
    </div>

    <DtEmpty
      v-else
      icon="lock"
      title="没有可进入的模块"
      hint="当前账号还没有任何模块权限，找管理员分配角色"
    />
  </DtCard>
</template>
