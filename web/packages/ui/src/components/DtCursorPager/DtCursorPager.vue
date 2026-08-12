<script setup lang="ts">
/**
 * @fileoverview DtCursorPager —— 游标翻页的上一页 / 下一页。
 *
 * ⚠ 游标分页**给不出总数**，所以这里只报当前页序与本页条数，不写「第 3 / 12 页」。
 * 拿 has_more 编一个总页数出来，用户会照着它去核对，而那个数是假的。
 * ⚠ 页码分页请用 `DtPagination`；时序集合按页码翻会静默重复或漏行。
 */
import DtButton from '../DtButton/DtButton.vue'

withDefaults(
  defineProps<{
    /** 1 起的页序。 */
    page: number
    /** 本页条数。总数不可知，能诚实说出口的只有这个。 */
    count: number
    hasPrev: boolean
    hasNext: boolean
    /** 取数中：两颗都禁用，避免连点翻过头。 */
    loading?: boolean | undefined
    ariaLabel?: string | undefined
  }>(),
  { loading: false, ariaLabel: '翻页' },
)

const emit = defineEmits<{ prev: []; next: [] }>()
</script>

<template>
  <nav class="dt-cursor-pager" :aria-label="ariaLabel">
    <p class="dt-cursor-pager__summary">
      第 {{ page }} 页 · 本页 {{ count }} 条
    </p>
    <div class="dt-cursor-pager__actions">
      <DtButton
        variant="ghost"
        intent="neutral"
        size="sm"
        :disabled="!hasPrev || loading"
        @click="emit('prev')"
      >
        上一页
      </DtButton>
      <DtButton
        variant="ghost"
        intent="neutral"
        size="sm"
        :disabled="!hasNext || loading"
        @click="emit('next')"
      >
        下一页
      </DtButton>
    </div>
  </nav>
</template>

<style scoped lang="scss">
.dt-cursor-pager {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;

  &__summary {
    margin: 0;
    font-size: 12px;
    color: var(--text-disabled);
  }

  &__actions {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
  }
}
</style>
