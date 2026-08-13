<script setup lang="ts">
/**
 * @fileoverview /system/* 四页共用的页签条。
 *
 * 页签数据直接取 navItems 的 system 分组，不另抄一份清单；
 * ⚠ 无权限的页签**整个不渲染**而不是禁用——禁用态等于告诉没权限的人
 * 「这里有个你够不着的东西」，而这条信息本身就不该给。
 *
 * 长相与可达性交给 `AppTabNav`，与 OPC UA 详情页的分区页签共用同一份标记，
 * 两处不会各长一个样。
 */
import { computed } from 'vue'

import type { AppTabItem } from '@/components/layout'
import { AppTabNav, NAV_ITEMS, navPermissionCodes } from '@/components/layout'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

const SYSTEM_CHILDREN =
  NAV_ITEMS.find((item) => item.key === 'system')?.children ?? []

const tabs = computed<AppTabItem[]>(() =>
  SYSTEM_CHILDREN.filter((item) => {
    const codes = navPermissionCodes(item)
    return codes.length === 0 || auth.can(codes, 'any')
  }).map((item) => ({
    key: item.key,
    label: item.label,
    icon: item.icon,
    to: item.to ?? '/',
  })),
)
</script>

<template>
  <AppTabNav :items="tabs" label="系统管理" />
</template>
