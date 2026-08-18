<script setup lang="ts">
/**
 * @fileoverview 一条绑定「指向哪个点位」的那一行：点位身份 + 一个挑点按钮。
 * 实时点位与历史序列两种来源把点位身份存在不同字段上，但这一行的样子完全相同，
 * 故只留一份；差异由调用方传进来的 `nodeKey` 与写回路径承担。
 *
 * 身份摆成一只只读值框（与上面那只下拉同高同底），而不是随内容涨的徽标：
 * `node_key` 前半截是 36 字的 source_id，撑得比整条右栏还宽。
 */
import { DtButton } from '@dt/ui'
import { computed } from 'vue'

const props = defineProps<{
  /** 当前指向的点位身份；空串 = 还没挑。 */
  nodeKey: string
}>()

const emit = defineEmits<{ pick: [] }>()

const SEPARATOR = ':'

/**
 * 把 `{source_id}:{point_code}` 拆成前后两截，认得出编码就把它单独摆出来。
 * ⚠ 只切第一个冒号：source_id 是 UUID 不含冒号，而 point_code 可以含。
 */
const parts = computed(() => {
  const at = props.nodeKey.indexOf(SEPARATOR)
  if (at < 0) return { source: '', code: props.nodeKey }
  return {
    source: props.nodeKey.slice(0, at + 1),
    code: props.nodeKey.slice(at + 1),
  }
})
</script>

<template>
  <div class="dt-point-ref">
    <!-- 全串挂 title：省略号吃掉的是 source_id，要核对时靠悬停 -->
    <span v-if="nodeKey !== ''" class="dt-point-ref__value" :title="nodeKey">
      <span class="dt-point-ref__source">{{ parts.source }}</span>
      <span class="dt-point-ref__code">{{ parts.code }}</span>
    </span>
    <span v-else class="dt-point-ref__value dt-point-ref__value--empty">
      还没挑点位
    </span>
    <DtButton
      class="dt-point-ref__pick"
      size="sm"
      variant="outline"
      icon="search"
      @click="emit('pick')"
    >
      挑点位
    </DtButton>
  </div>
</template>

<style scoped lang="scss">
.dt-point-ref {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;

  &__value {
    display: flex;
    flex: 1;
    min-width: 0;
    align-items: center;
    height: var(--ctl-h-sm);
    padding: 0 var(--ctl-px-sm);
    border: 1px solid var(--border-default);
    border-radius: var(--ctl-r-sm);
    background: var(--surface-sunken);
    font-family: var(--font-mono);
    font-size: var(--ctl-fs-sm);
    line-height: 1;

    &--empty {
      color: var(--text-disabled);
      font-family: inherit;
    }
  }

  // 两截都能被省略号吃，但 source_id 先吃：点位编码才是认人的那一截
  &__source,
  &__code {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  &__source {
    flex: 0 100 auto;
    color: var(--text-disabled);
  }

  &__code {
    flex: 0 1 auto;
    color: var(--text-primary);
  }

  &__pick {
    flex-shrink: 0;
  }
}
</style>
