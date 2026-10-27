<script setup lang="ts">
/** @fileoverview 日常建模与第三方接入各自的分区导航。 */
import { DtIcon, DtTag } from '@dt/ui'
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import AppTabNav from '@/components/layout/AppTabNav.vue'

const route = useRoute()
const isIntegration = computed(() =>
  ['/modeling/integration', '/modeling/templates', '/modeling/instances'].some(
    (path) => route.path === path || route.path.startsWith(`${path}/`),
  ),
)
const workspaceItems = [
  {
    key: 'pipelines',
    label: '建模工作台',
    icon: 'workflow',
    to: '/modeling/pipelines',
  },
  { key: 'runs', label: '运行记录', icon: 'activity', to: '/modeling/runs' },
  { key: 'models', label: '模型版本', icon: 'layers', to: '/modeling/models' },
  {
    key: 'services',
    label: '部署服务',
    icon: 'share',
    to: '/modeling/services',
  },
]
const integrationItems = [
  {
    key: 'guide',
    label: '接入指南',
    icon: 'list-checks',
    to: '/modeling/integration',
  },
  {
    key: 'templates',
    label: '已发布模板',
    icon: 'layers',
    to: '/modeling/templates',
  },
  {
    key: 'instances',
    label: '接入实例',
    icon: 'workflow',
    to: '/modeling/instances',
  },
]
</script>

<template>
  <div class="modeling-nav">
    <template v-if="isIntegration">
      <RouterLink class="modeling-nav__link" to="/modeling/pipelines">
        <DtIcon name="arrow-left" :size="14" />返回建模工作台
      </RouterLink>
      <DtTag intent="info">第三方接入</DtTag>
      <AppTabNav :items="integrationItems" label="第三方接入导航" />
    </template>
    <template v-else>
      <AppTabNav :items="workspaceItems" label="分析建模导航" />
      <RouterLink
        class="modeling-nav__link modeling-nav__integration"
        to="/modeling/integration"
      >
        <DtIcon name="share" :size="14" />第三方接入
      </RouterLink>
    </template>
  </div>
</template>

<style scoped lang="scss">
.modeling-nav {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  > nav {
    flex: 1;
    min-width: 0;
  }
  &__link {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    color: var(--text-secondary);
    font-size: var(--font-size-compact);
    padding: 0.5rem 0;
    &:hover {
      color: var(--accent-primary);
    }
    &:focus-visible {
      outline: 2px solid var(--accent-primary);
      outline-offset: 4px;
    }
  }
}
</style>
