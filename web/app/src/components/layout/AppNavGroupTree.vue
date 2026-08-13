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

    <!-- v-if 而不是 v-show：藏起来的链接仍可 Tab 到达，焦点会落到看不见的东西上。
         Transition 只在离场那几帧里留住节点，收完即摘，Tab 序照旧不含合起来的项。 -->
    <Transition name="nav-sub">
      <div v-if="isOpen" :id="`nav-group-${item.key}`" class="nav-tree__panel">
        <div class="nav-tree__children">
          <RouterLink
            v-for="child in item.children"
            :key="child.key"
            :to="child.to ?? '/'"
            class="flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs transition-colors"
            :class="
              isActive(child.to)
                ? 'bg-accent-primary/10 text-accent-on-surface'
                : 'text-text-secondary hover:bg-accent-primary/10 hover:text-text-primary'
            "
            :aria-current="isActive(child.to) ? 'page' : undefined"
          >
            <DtIcon :name="child.icon" :size="15" />
            <span class="truncate">{{ child.label }}</span>
          </RouterLink>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/tokens-bridge' as t;

.nav-tree {
  display: flex;
  flex-direction: column;
  gap: 4px;
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

// 开合动画走 grid 的 0fr → 1fr：高度不用写死，二级项增减都不必回来改数。
// ⚠ 只有网格项自己能压到零高时 0fr 才收得动，故 __children 必须 overflow: hidden。
.nav-tree__panel {
  display: grid;
  grid-template-rows: 1fr;
  transition:
    grid-template-rows 180ms ease,
    opacity 180ms ease;
}

.nav-tree__children {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: hidden;
  // 二级缩进对齐一级图标右侧，视觉上挂在它下面
  margin-left: 18px;
  padding-left: 8px;
  padding-block: 2px;
  border-left: 1px solid var(--border-subtle);
}

.nav-sub-enter-from,
.nav-sub-leave-to {
  grid-template-rows: 0fr;
  opacity: 0;
}

// 开合是一次纵向的高度伸缩，对前庭敏感的人要整条关掉
@include t.reduced-motion {
  .nav-tree__panel {
    transition: none;
  }
}
</style>
