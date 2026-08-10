<script setup lang="ts">
/**
 * @fileoverview /system/* 四页共用的页签条。
 *
 * 页签数据直接取 navItems 的 system 分组，不另抄一份清单；
 * ⚠ 无权限的页签**整个不渲染**而不是禁用——禁用态等于告诉没权限的人
 * 「这里有个你够不着的东西」，而这条信息本身就不该给。
 *
 * ⚠ 用 RouterLink 而不是按钮：它是导航，地址会变，中键新标签打开与复制链接
 * 都该照常可用。同理不用 DtSegmented——那个组件切换的是同一块内容的呈现。
 */
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { DtIcon } from '@dt/ui'

import { NAV_ITEMS, navPermissionCodes } from '@/components/layout'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const auth = useAuthStore()

const SYSTEM_CHILDREN =
  NAV_ITEMS.find((item) => item.key === 'system')?.children ?? []

const tabs = computed(() =>
  SYSTEM_CHILDREN.filter((item) => {
    const codes = navPermissionCodes(item)
    return codes.length === 0 || auth.can(codes, 'any')
  }),
)
</script>

<template>
  <nav
    v-if="tabs.length > 0"
    class="flex flex-wrap items-center gap-1 border-b border-border-subtle pb-2"
    aria-label="系统管理"
  >
    <RouterLink
      v-for="tab in tabs"
      :key="tab.key"
      :to="tab.to ?? '/'"
      class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] transition-colors"
      :class="
        route.path === tab.to
          ? 'bg-accent-primary/10 text-accent-primary'
          : 'text-text-secondary hover:bg-accent-primary/10 hover:text-text-primary'
      "
      :aria-current="route.path === tab.to ? 'page' : undefined"
    >
      <DtIcon :name="tab.icon" :size="14" />
      {{ tab.label }}
    </RouterLink>
  </nav>
</template>
