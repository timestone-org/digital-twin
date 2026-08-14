<script setup lang="ts">
/**
 * @fileoverview 模块硬失败时的占位：整格换成它，**只影响这一格**。
 * 清单缺失、异步 chunk 加载失败、渲染抛错三种成因由 `ModuleRenderer` 判定并给出文案。
 */
import { DtIcon } from '@dt/ui'

defineProps<{
  /** 这一格出了什么事。 */
  title: string
  /** 具体原因，来自异常消息或未知的模块类型；空串表示没有更多可说的。 */
  detail: string
}>()
</script>

<template>
  <div class="dt-module-fallback" role="alert">
    <DtIcon name="alert-triangle" :size="22" :stroke-width="1.5" />
    <p class="dt-module-fallback__title">{{ title }}</p>
    <p v-if="detail" class="dt-module-fallback__detail" :title="detail">
      {{ detail }}
    </p>
  </div>
</template>

<style scoped lang="scss">
.dt-module-fallback {
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
  border: 1px dashed var(--state-danger);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--state-danger) 6%, transparent);
  color: var(--state-danger);
  gap: 4px;
  overflow: hidden;
  text-align: center;

  &__title {
    font-size: 12px;
    font-weight: 600;
  }

  // 原因可能很长；截断但保留 title 属性，鼠标停上去看得全
  &__detail {
    max-width: 90%;
    color: var(--text-secondary);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow: hidden;
  }
}
</style>
