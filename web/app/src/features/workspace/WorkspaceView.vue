<script setup lang="ts">
/** @fileoverview 工作页签的根宿主，公开、投屏与嵌入页面沿用独立路由出口。 */
import { provide } from 'vue'
import { useRouter, RouterView } from 'vue-router'
import { WORKSPACE_KEY } from './context'
import { useWorkspaceTabs } from './useWorkspaceTabs'
import WorkspacePage from './WorkspacePage.vue'

const workspace = useWorkspaceTabs(useRouter())
provide(WORKSPACE_KEY, workspace)
</script>

<template>
  <WorkspacePage
    v-for="tab in workspace.tabs.value"
    :key="`${tab.key}:${tab.generation}`"
    :tab="tab"
    :active="tab.key === workspace.activeKey.value"
  />
  <RouterView v-if="workspace.activeKey.value === ''" />
</template>
