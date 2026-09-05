<script setup lang="ts">
/**
 * @fileoverview 代表树：缩进的规则清单，一层一级，读者要看的是「先按哪一列切、
 * 切在哪个值上」。
 *
 * ⚠ 递归自引用而不是嵌套三层 `v-for`：深度虽然限死在 3，但嵌套写法一层一个
 * `<ul>`，模板嵌套立刻顶到上限，而且改深度就得再抄一遍。
 */
import type { TreeBranch } from '../scripts/structureParts'

defineProps<{ branches: readonly TreeBranch[] }>()
</script>

<template>
  <ul class="dt-ml-tree">
    <li v-for="one in branches" :key="one.key" class="dt-ml-tree__node">
      <p class="dt-ml-tree__line">
        <span v-if="one.condition !== ''" class="dt-ml-tree__when">
          {{ one.condition }}
        </span>
        <span class="dt-ml-tree__then">{{ one.text }}</span>
      </p>
      <TreeOutline v-if="one.children.length > 0" :branches="one.children" />
    </li>
  </ul>
</template>

<style scoped lang="scss">
.dt-ml-tree {
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--ctl-hint-fs-sm);

  // 子级往里缩一格，并沿着缩进画一条竖线：光靠缩进，三层之后哪一条挂在哪一条
  // 下面就得靠数空格
  .dt-ml-tree {
    margin-left: 0.5rem;
    padding-left: 0.625rem;
    border-left: 1px dashed var(--text-disabled);
  }

  &__line {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    margin: 0.125rem 0;
  }

  &__when {
    padding: 0 0.25rem;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    color: var(--text-title);
    font-family: var(--font-digit);
  }

  &__then {
    color: var(--text-secondary);
  }
}
</style>
