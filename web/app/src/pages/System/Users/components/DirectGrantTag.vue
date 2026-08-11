<script setup lang="ts">
/**
 * @fileoverview 直权条数的呈现。表格单元格与卡片共用一份，两种视图才不会漂移。
 * ⚠ 0 渲染「无」而不是「—」：没有直权是一条已知事实（权力全部来自角色），
 * 破折号的含义是取值缺席。
 */
import { computed } from 'vue'
import { DtTag } from '@dt/ui'

const props = defineProps<{ count: number }>()

const hint = computed(() => `比角色多 ${props.count} 个直接授予的权限码`)
</script>

<template>
  <span v-if="props.count === 0" class="text-xs text-text-disabled">无</span>
  <DtTag v-else intent="info" mono :title="hint">+{{ props.count }}</DtTag>
</template>
