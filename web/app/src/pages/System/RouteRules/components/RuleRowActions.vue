<script setup lang="ts">
/**
 * @fileoverview 一条路由规则上的三个操作入口，表格单元格与卡片共用。
 * ⚠ PermGuard 在根之外：无权限时连调用方挂上来的分隔线一起消失，
 * 卡片底部才不会剩一条空横线。因此 class 要显式落到内层 div 上——
 * PermGuard 渲染的是插槽 fragment，自动透传落不下来。
 */
import type { RouteRule } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'

const props = defineProps<{ rule: RouteRule }>()

const emit = defineEmits<{
  edit: [rule: RouteRule]
  'toggle-enabled': [rule: RouteRule]
  remove: [rule: RouteRule]
}>()

defineOptions({ inheritAttrs: false })
</script>

<template>
  <PermGuard :codes="[PERMISSION_CODES.routeRuleManage]">
    <div v-bind="$attrs" class="flex items-center justify-end gap-1">
      <DtButton
        variant="ghost"
        intent="neutral"
        size="sm"
        icon="pencil"
        aria-label="编辑规则"
        title="编辑规则"
        @click="emit('edit', props.rule)"
      />
      <DtButton
        variant="ghost"
        intent="neutral"
        size="sm"
        :icon="props.rule.is_enabled ? 'toggle-right' : 'toggle-left'"
        :aria-label="props.rule.is_enabled ? '停用' : '启用'"
        :title="props.rule.is_enabled ? '停用' : '启用'"
        @click="emit('toggle-enabled', props.rule)"
      />
      <DtButton
        variant="ghost"
        intent="danger"
        size="sm"
        icon="trash"
        aria-label="删除规则"
        title="删除规则"
        @click="emit('remove', props.rule)"
      />
    </div>
  </PermGuard>
</template>
