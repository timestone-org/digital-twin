<script setup lang="ts">
/**
 * @fileoverview 一串权限码的 chips：常驻前几枚，其余收进可就地展开的 `+N`。
 * 角色页与路由规则页的表格单元格与卡片共用它，两种视图才不会各自截断。
 *
 * ⚠ 不在这里排序：路由规则的码序由规则作者决定，重排数据不是呈现件的事。
 */
import { computed } from 'vue'
import { DtTag } from '@dt/ui'

const props = withDefaults(
  defineProps<{
    codes: readonly string[]
    /** 常驻 chips 的枚数，其余收进 `+N`。 */
    max?: number
    /** 空集合的文案。空码的语义按场景不同，组件不许替调用方定。 */
    empty?: string
  }>(),
  { max: 6, empty: '没有任何权限码' },
)

const shown = computed(() => props.codes.slice(0, props.max))
const rest = computed(() => props.codes.slice(props.max))
</script>

<template>
  <div class="code-chips flex min-w-0 flex-wrap items-center gap-1.5">
    <span v-if="codes.length === 0" class="text-xs text-text-disabled">
      {{ empty }}
    </span>
    <DtTag v-for="code in shown" :key="code" mono>{{ code }}</DtTag>
    <details v-if="rest.length > 0" class="code-chips__more min-w-0">
      <summary class="list-none">
        <DtTag mono :title="rest.join(' ')">+{{ rest.length }}</DtTag>
      </summary>
      <div class="mt-2 flex flex-wrap gap-1.5">
        <DtTag v-for="code in rest" :key="code" mono>{{ code }}</DtTag>
      </div>
    </details>
  </div>
</template>

<style scoped lang="scss">
// Safari 旧版不认 list-style: none，三角要单独摘
.code-chips__more summary::-webkit-details-marker {
  display: none;
}

.code-chips__more summary {
  cursor: pointer;
}
</style>
