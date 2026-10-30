<script setup lang="ts">
/** @fileoverview 流水线、工作流、模型实例与部署的统一导航。 */
import { DtIcon } from '@dt/ui'
import { RouterLink } from 'vue-router'
import AppTabNav from '@/components/layout/AppTabNav.vue'

const workspaceItems = [
  {
    key: 'pipelines',
    label: '建模工作台',
    icon: 'workflow',
    to: '/modeling/pipelines',
  },
  {
    key: 'templates',
    label: '已发布工作流',
    icon: 'layers',
    to: '/modeling/templates',
  },
  {
    key: 'instances',
    label: '模型实例',
    icon: 'workflow',
    to: '/modeling/instances',
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
</script>

<template>
  <div class="modeling-nav">
    <AppTabNav :items="workspaceItems" label="分析建模导航" />
    <RouterLink class="modeling-nav__link" to="/modeling/integration">
      <DtIcon name="share" :size="14" />第三方接入
    </RouterLink>
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
