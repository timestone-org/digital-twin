<script setup lang="ts">
/**
 * @fileoverview AppNavRail —— 左侧导航。两种形态：**展开**（图标 + 文字、二级
 * 就地展开）与**折叠**（图标条、二级悬停飞出），形态记在 localStorage。
 * 顶部 Logo 回工作台，底部头像进个人中心与登出。新增页面只加 `navItems.ts`。
 */
import { computed } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { DtButton, DtIcon } from '@dt/ui'

import { AppLogo } from '@/components/brand'
import { appConfig } from '@/config/app'
import { useSidebar } from '@/composables/useSidebar'
import { useAuthStore } from '@/stores/auth'
import AppNavGroupFlyout from './AppNavGroupFlyout.vue'
import AppNavGroupTree from './AppNavGroupTree.vue'
import { NAV_ITEMS } from './navItems'
import { isPathActive, visibleNavItems } from './navTree'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { isCollapsed, toggle } = useSidebar()

const items = computed(() =>
  visibleNavItems(NAV_ITEMS, (codes) => auth.can(codes, 'any')),
)

function isActive(to: string | undefined): boolean {
  return isPathActive(route.path, to)
}

const userInitial = computed(() =>
  (auth.user?.full_name || auth.user?.username || '?')
    .slice(0, 1)
    .toUpperCase(),
)
const userTitle = computed(() => {
  const name = auth.user?.full_name || auth.user?.username || '未登录'
  const role = auth.user?.role?.name
  return role ? `${name} · ${role}` : name
})

const toggleLabel = computed(() =>
  isCollapsed.value ? '展开侧栏' : '折叠侧栏',
)

async function onLogout(): Promise<void> {
  await auth.logout()
  await router.replace({ name: 'login' })
}
</script>

<template>
  <aside
    class="nav-rail relative z-40 flex h-full shrink-0 flex-col border-r border-border-subtle bg-surface-panel/60 backdrop-blur-md transition-[width] duration-200"
    :class="isCollapsed ? 'w-[60px] items-center' : 'w-[216px]'"
  >
    <RouterLink
      to="/"
      class="flex h-16 w-full shrink-0 items-center gap-2.5 text-accent-on-surface"
      :class="isCollapsed ? 'justify-center' : 'px-3'"
      title="返回工作台"
      aria-label="返回工作台"
    >
      <AppLogo :size="isCollapsed ? 26 : 30" />
      <span
        v-if="!isCollapsed"
        class="font-display min-w-0 truncate text-[13px] font-semibold tracking-[0.16em] text-text-title"
      >
        {{ appConfig.shortName }}
      </span>
    </RouterLink>

    <div
      class="mx-3 h-px shrink-0 bg-gradient-to-r from-transparent via-accent-primary/30 to-transparent"
      :class="isCollapsed ? 'w-9' : 'self-stretch'"
    />

    <!-- ⚠ 折叠态不能开 overflow：只设 overflow-y 时 overflow-x 按规范也算成
         auto，nav 于是成了裁剪盒，而飞出面板正是 left:100% 伸到 nav 之外的——
         开着它二级导航在折叠态下直接够不到。展开态没有飞出面板，可以照常滚。
         等一级项多到折叠态也需要滚时，得把面板改成 teleport + fixed 定位。 -->
    <nav
      id="app-nav"
      class="flex flex-1 flex-col gap-2.5 py-3"
      :class="isCollapsed ? 'items-center' : 'overflow-y-auto px-2'"
      aria-label="主导航"
    >
      <template v-for="item in items" :key="item.key">
        <AppNavGroupFlyout
          v-if="item.children?.length && isCollapsed"
          :item="item"
          :current-path="route.path"
        />
        <AppNavGroupTree
          v-else-if="item.children?.length"
          :item="item"
          :current-path="route.path"
        />
        <RouterLink
          v-else
          :to="item.to ?? '/'"
          class="relative flex h-10 items-center gap-2 rounded-md text-[13px] transition-colors"
          :class="[
            isCollapsed ? 'w-10 justify-center' : 'px-2.5',
            isActive(item.to)
              ? 'bg-accent-primary/10 text-accent-on-surface'
              : 'text-text-secondary hover:bg-accent-primary/10 hover:text-text-primary',
          ]"
          :title="item.label"
          :aria-label="item.label"
          :aria-current="isActive(item.to) ? 'page' : undefined"
        >
          <span
            v-if="isActive(item.to)"
            class="absolute -left-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-accent-primary"
          />
          <!-- 展开态与分组按钮里的图标同档（16），差一档在一列里就看得出参差 -->
          <DtIcon :name="item.icon" :size="isCollapsed ? 19 : 16" />
          <span v-if="!isCollapsed" class="truncate">{{ item.label }}</span>
        </RouterLink>
      </template>
    </nav>

    <div
      class="flex w-full shrink-0 items-center border-t border-border-subtle py-3"
      :class="isCollapsed ? 'flex-col gap-2' : 'gap-2.5 px-3'"
    >
      <!--
        头像即个人中心入口。用 RouterLink 而不是按钮：它是导航不是动作，
        中键新标签打开、复制链接都该照常可用。刻意不进 NAV_ITEMS——
        那份清单的每一项都要与 router 的 meta.permissions 对齐，而个人中心没有权限码。
      -->
      <RouterLink
        to="/profile"
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-surface-raised text-xs font-semibold text-accent-on-surface transition-colors"
        :class="
          isActive('/profile')
            ? 'border-accent-primary'
            : 'border-border-default hover:border-accent-primary'
        "
        :title="userTitle"
        :aria-label="`个人中心 · ${userTitle}`"
        :aria-current="isActive('/profile') ? 'page' : undefined"
      >
        {{ userInitial }}
      </RouterLink>
      <span
        v-if="!isCollapsed"
        class="min-w-0 flex-1 truncate text-xs text-text-secondary"
      >
        {{ userTitle }}
      </span>
      <DtButton
        variant="ghost"
        intent="neutral"
        size="sm"
        icon="log-out"
        aria-label="退出登录"
        title="退出登录"
        @click="onLogout"
      />
    </div>

    <!-- 骑在侧栏与内容的分界线上，两态之间切换 -->
    <span class="nav-toggle">
      <DtButton
        variant="soft"
        intent="primary"
        size="sm"
        :icon="isCollapsed ? 'chevron-down' : 'chevron-up'"
        :aria-label="toggleLabel"
        :aria-expanded="!isCollapsed"
        aria-controls="app-nav"
        :title="toggleLabel"
        @click="toggle"
      />
    </span>
  </aside>
</template>

<style scoped lang="scss">
@use '@/styles/tokens-bridge' as t;

// 骑在边界上的小圆钮。24px 是 WCAG 2.5.8 给的点击目标下限，不要再往下调；
// ⚠ right 必须等于 -(尺寸 / 2)，否则它不在分界线上而是偏到一侧
$toggle-size: 24px;

.nav-toggle {
  position: absolute;
  right: -$toggle-size * 0.5;
  top: 50%;
  z-index: 1;
  display: inline-flex;
  transform: translateY(-50%);
  border-radius: var(--radius-pill);
  // 挡住身下的分界线，否则边框会从半透明的钮身里透出来
  background: var(--surface-base);

  // 比 sm 档再小一号：它是贴边的辅助控件，按正常按钮的分量做会盖过导航本身
  :deep(.dt-btn) {
    width: $toggle-size;
    height: $toggle-size;
    border-radius: var(--radius-pill);
  }

  // ⚠ 图标库只有上下向的 chevron；统一转 -90° 后 up 读作「收起」、down 读作「展开」
  :deep(.dt-icon) {
    transform: rotate(-90deg);
  }
}

// 展开 / 折叠是一次整块的横向位移，对前庭敏感的人要整条关掉
@include t.reduced-motion {
  .nav-rail {
    transition: none;
  }
}
</style>
