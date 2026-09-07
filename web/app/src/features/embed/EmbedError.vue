<script setup lang="ts">
/** @fileoverview 嵌入首航、续租或路由授权失败时接管整页的明确错误态。 */

defineProps<{ message: string }>()
</script>

<template>
  <main
    class="dt-grid-bg flex h-screen w-screen items-center justify-center bg-surface-base p-6"
  >
    <section
      class="w-full max-w-xl rounded-lg border border-border-default bg-surface-panel p-6 text-center"
      role="alert"
      data-test="embed-error"
    >
      <h1 class="m-0 text-lg font-semibold text-text-title">
        嵌入页面无法打开
      </h1>
      <p class="mb-0 mt-3 text-sm leading-6 text-text-secondary">
        {{ message }}
      </p>
    </section>
  </main>
</template>
