<script setup lang="ts">
/**
 * @fileoverview 路由规则的 HTTP 方法徽标，表格与卡片共用。
 * ⚠ 正文保留字面 `*`（运维就是照 `*` 搜的），读法挂在 title 上。
 */
import { computed } from 'vue'
import type { HttpMethod } from '@dt/contracts'
import { DtTag } from '@dt/ui'

const props = defineProps<{ method: HttpMethod }>()

const label = computed(() =>
  props.method === '*' ? '任意方法' : `${props.method} 请求`,
)
</script>

<template>
  <DtTag mono :title="label">{{ method }}</DtTag>
</template>
