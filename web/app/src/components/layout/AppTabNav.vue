<script setup lang="ts">
/**
 * @fileoverview 页内分区的页签条。**只管长相与可达性，不管页签从哪来。**
 *
 * ⚠ 页签的标记全系统只此一份：系统管理与 OPC UA 详情都用它。两处各写一份
 * 的话，改了其中一处没有任何人会注意到另一处还是老样子——收进一个组件，
 * 长相漂移就不可能发生。
 *
 * ⚠ 用 RouterLink 而不是按钮：它是导航，地址会变，中键新标签打开与复制链接
 * 都该照常可用。同理不用 `DtSegmented`——那个组件切换的是**同一块内容的呈现**
 * （表格/卡片），而这里切的是不同内容。
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
