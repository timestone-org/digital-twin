<script setup lang="ts">
/**
 * @fileoverview 按权限码条件渲染。
 * ⚠ 这是闸 3，**不是安全边界**：它让元素在无权限时**不存在于 DOM**，
 * 而不是仅仅隐藏——隐藏元素仍可被读取与触发。真正的拦截在后端。
 *
 * ⚠ 页面级的主动作（顶栏那个「新建 X」）藏掉时要开 `explain`：只读账号打开
 * 页面只会看到主按钮凭空不见，既分不清是功能没做、页面坏了、还是自己没权限，
 * 最后变成一张「这个功能是不是没上线」的工单。行内小按钮不必——每行都挂一句
 * 「只读」是纯噪音，那时页面顶上的这一句已经说清楚了。
 */
import { computed } from 'vue'

import { DtTag } from '@dt/ui'

import { useAuthStore } from '@/stores/auth'

const props = withDefaults(
  defineProps<{
    codes: readonly string[]
    mode?: 'all' | 'any'
    /** 没权限时留一句说明，而不是什么都不留。 */
    explain?: boolean
  }>(),
  { mode: 'all', explain: false },
)

const auth = useAuthStore()
const allowed = computed(() => auth.can(props.codes, props.mode))
</script>

<template>
  <slot v-if="allowed" />
  <slot v-else name="fallback">
    <DtTag v-if="explain" size="sm" data-test="perm-readonly">
      只读 · 当前账号仅可查看
    </DtTag>
  </slot>
</template>
