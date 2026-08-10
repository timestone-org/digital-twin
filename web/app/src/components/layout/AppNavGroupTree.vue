<script setup lang="ts">
/**
 * @fileoverview 展开态的二级导航：一级项是开合按钮，二级项就地展开成真实链接。
 * 与折叠态的飞出面板（AppNavGroupFlyout）是同一份数据的两种呈现。
 */
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { DtButton, DtIcon } from '@dt/ui'

import type { NavItem } from './navItems'
import { isGroupActive, isPathActive } from './navTree'

const props = defineProps<{ item: NavItem; currentPath: string }>()

const groupActive = computed(() => isGroupActive(props.currentPath, props.item))
// 当前路由落在组内时默认摊开，否则进这一页看不到自己在哪
const isOpen = ref(groupActive.value)

watch(groupActive, (active) => {
  if (active) isOpen.value = true
})

function isActive(to: string | undefined): boolean {
  return isPathActive(props.currentPath, to)
}
</script>

<template>
  <div class="nav-tree">
    <DtButton
      class="nav-tree__trigger"
      :variant="groupActive ? 'soft' : 'ghost'"
      :intent="groupActive ? 'primary' : 'neutral'"
      size="md"
      block
      :icon="item.icon"
      :icon-right="isOpen ? 'chevron-up' : 'chevron-down'"
      :aria-expanded="isOpen"
      :aria-controls="`nav-group-${item.key}`"
      @click="isOpen = !isOpen"
    >
      {{ item.label }}
    </DtButton>

    <!-- v-if 而不是 v-show：藏起来的链接仍可 Tab 到达，焦点会落到看不见的东西上 -->
    <div v-if="isOpen" :id="`nav-group-${item.key}`" class="nav-tree__children">
      <RouterLink
        v-for="child in item.children"
        :key="child.key"
        :to="child.to ?? '/'"
        class="flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs transition-colors"
        :class="
          isActive(child.to)
            ? 'bg-accent-primary/10 text-accent-primary'
            : 'text-text-secondary hover:bg-accent-primary/10 hover:text-text-primary'
        "
        :aria-current="isActive(child.to) ? 'page' : undefined"
      >
        <DtIcon :name="child.icon" :size="15" />
        <span class="truncate">{{ child.label }}</span>
      </RouterLink>
    </div>
  </div>
</template>

<style scoped lang="scss">
.nav-tree {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

// class 透传到 DtButton 的根节点上，scoped 属性一起加上去，特异度因此高过
// 组件自己的 `.dt-btn`（单类选择器同级时跨文件的先后顺序不确定，压不稳）。
// 与同级的叶子链接对齐：同高（md = 40px）、同内边距、同字号，
// 差一档就会在一列里看出参差。
.nav-tree__trigger {
  justify-content: flex-start;
  padding-inline: 10px;
  font-size: 13px;

  :deep(.dt-btn__label) {
    flex: 1;
    text-align: left;
    font-weight: 500;
  }
}

.nav-tree__children {
  display: flex;
  flex-direction: column;
  gap: 2px;
  // 二级缩进对齐一级图标右侧，视觉上挂在它下面
  margin-left: 18px;
  padding-left: 8px;
  border-left: 1px solid var(--border-subtle);
}
</style>
