<script setup lang="ts">
/** @fileoverview 小视口的主导航入口，复用完整菜单与对话框焦点管理。 */
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { DtButton, DtModal } from '@dt/ui'
import AppNavRail from './AppNavRail.vue'

const isOpen = ref(false)
const route = useRoute()
watch(
  () => route.path,
  () => {
    isOpen.value = false
  },
)

function onNavigate(event: MouseEvent): void {
  if (event.target instanceof Element && event.target.closest('a[href]')) {
    isOpen.value = false
  }
}
</script>

<template>
  <DtButton
    variant="outline"
    intent="neutral"
    size="sm"
    icon="layout-grid"
    aria-label="打开主导航"
    :aria-expanded="isOpen"
    aria-haspopup="dialog"
    @click="isOpen = true"
    >导航</DtButton
  >
  <DtModal v-model="isOpen" title="主导航" width="20rem">
    <div @click="onNavigate"><AppNavRail menu /></div>
  </DtModal>
</template>
