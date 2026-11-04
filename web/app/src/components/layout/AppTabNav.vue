<script setup lang="ts">
/**
 * @fileoverview 页内分区的链接页签，负责导航样式与可访问性。
 * 选用规则见 docs/agents/project-structure-typescript.md §4.2。
 */
import { RouterLink, useRoute } from 'vue-router'

import { DtIcon } from '@dt/ui'

export interface AppTabItem {
  key: string
  label: string
  icon: string
  to: string
}

defineProps<{
  items: readonly AppTabItem[]
  /**
   * 无可见标题时给整条页签命名，屏幕阅读器靠它区分页面上的多个 nav。
   * ⚠ 不叫 `ariaLabel`：那个名字与 DOM 的 `aria-label` 属性同名，模板里写
   * `aria-label="…"` 到底是喂 prop 还是喂属性会变得含糊。
   */
  label: string
}>()

const route = useRoute()
</script>

<template>
  <nav
    v-if="items.length > 0"
    class="flex flex-wrap items-center gap-1 border-b border-border-subtle pb-2"
    :aria-label="label"
  >
    <RouterLink
      v-for="item in items"
      :key="item.key"
      :to="item.to"
      class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] transition-colors"
      :class="
        route.path === item.to
          ? 'bg-accent-primary/10 text-accent-on-surface'
          : 'text-text-secondary hover:bg-accent-primary/10 hover:text-text-primary'
      "
      :aria-current="route.path === item.to ? 'page' : undefined"
    >
      <DtIcon :name="item.icon" :size="14" />
      {{ item.label }}
    </RouterLink>
  </nav>
</template>
