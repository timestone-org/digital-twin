<script setup lang="ts">
/** @fileoverview 为每个页签隔离路由注入，编辑器离开时停用、关闭时销毁。 */
import { computed, provide, shallowReactive, watch } from 'vue'
import { routeLocationKey, RouterView } from 'vue-router'
import { WORKSPACE_PAGE_KEY, type WorkspaceTab } from './context'

const props = defineProps<{ tab: WorkspaceTab; active: boolean }>()
// ⚠ useRoute 必须读本页签快照，否则后台编辑器会跟随另一页的参数重载草稿。
const snapshot = computed(() => props.tab.route)
const route = shallowReactive({ ...snapshot.value })
watch(
  () => props.tab.route,
  (next) => Object.assign(route, next),
  { flush: 'sync' },
)
provide(routeLocationKey, route)
provide(WORKSPACE_PAGE_KEY, {
  get key() {
    return props.tab.key
  },
  active: computed(() => props.active),
  get cached() {
    return props.tab.cached
  },
})
</script>

<template>
  <RouterView v-slot="{ Component }" :route="route">
    <KeepAlive v-if="tab.cached">
      <component :is="Component" v-if="active" />
    </KeepAlive>
    <component :is="Component" v-else-if="active" />
  </RouterView>
</template>
