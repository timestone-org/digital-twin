<script setup lang="ts">
/**
 * @fileoverview 应用根组件：路由出口 + 两个全局反馈宿主。页面各自负责自己的布局。
 * ⚠ 宿主挂在这里而不是 AppShell：登录页与 403/404 不套壳，但它们同样要能弹消息。
 * 换肤注入同理挂在这里：它写的是文档根，不套壳的页面也要跟着变。
 */
import { DtConfirmHost, DtToastHost } from '@dt/ui'

import { useGlobalTheme } from '@/composables/useGlobalTheme'

useGlobalTheme()
</script>

<template>
  <RouterView />
  <DtToastHost />
  <DtConfirmHost />
</template>
