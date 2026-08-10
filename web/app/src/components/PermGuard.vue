<script setup lang="ts">
/**
 * @fileoverview 按权限码条件渲染。
 * ⚠ 这是闸 3，**不是安全边界**：它让元素在无权限时**不存在于 DOM**，
 * 而不是仅仅隐藏——隐藏元素仍可被读取与触发。真正的拦截在后端。
 */
import { computed } from 'vue'

import { useAuthStore } from '@/stores/auth'

const props = withDefaults(
  defineProps<{ codes: readonly string[]; mode?: 'all' | 'any' }>(),
  { mode: 'all' },
)

const auth = useAuthStore()
const allowed = computed(() => auth.can(props.codes, props.mode))
</script>

<template>
  <slot v-if="allowed" />
  <slot v-else name="fallback" />
</template>
