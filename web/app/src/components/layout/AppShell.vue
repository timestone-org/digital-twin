<script setup lang="ts">
/**
 * @fileoverview AppShell —— 管理端外壳（左侧导航 + 顶栏 + 主内容）。
 * 登录页与错误页不套这层壳。
 *
 * ⚠ 主内容**铺满可用宽度**，刻意不提供「限宽居中」的开关：有开关就一定会出现
 * 一半页面限宽、一半页面铺满，在同一套导航下来回切换时整块内容左右跳。
 * 单个页面要控制可读行宽，在自己的栅格里做（列数、max-w），不要收窄整页。
 *
 * ⚠ `<main>` 是 flex 列 + overflow-hidden，**自己不滚**：滚动交给页面里的
 * DtDataView，表体才能铺满剩余高度并把分页器钉在底部。页面根节点因此必须是
 * `h-full flex flex-col min-h-0`，否则内容会被裁掉。
 */
import AppNavRail from './AppNavRail.vue'
import AppTopbar from './AppTopbar.vue'

defineProps<{
  title?: string | undefined
  subtitle?: string | undefined
  /** 给了才在标题左侧显示返回入口，取值是站内路径。 */
  backTo?: string | undefined
  backLabel?: string | undefined
}>()
</script>

<template>
  <div
    class="dt-grid-bg flex h-screen w-screen overflow-hidden bg-surface-base"
  >
    <AppNavRail />

    <div class="flex min-w-0 flex-1 flex-col">
      <AppTopbar
        :title="title"
        :subtitle="subtitle"
        :back-to="backTo"
        :back-label="backLabel"
      >
        <template #actions><slot name="actions" /></template>
      </AppTopbar>

      <main class="flex min-h-0 flex-1 flex-col overflow-hidden p-5">
        <slot />
      </main>
    </div>
  </div>
</template>
