<script setup lang="ts">
/**
 * @fileoverview 权限档位的唯一呈现：颜色 + 文字 + 图标三条通道，表格与卡片共用。
 * ⚠ 只靠颜色分不出四档——色觉差异与暗屏都会把 warning 和 danger 压成同一坨，
 * 故每一档都必须同时给出文字与图形。
 */
import { computed } from 'vue'
import type { DtIntent, PermissionKind } from '@dt/contracts'
import { DtIcon, DtTag } from '@dt/ui'

/** 四档的展示口径：文案 + 色意 + 图形，与后端 `kind` 一一对应。 */
const KIND_META: Record<
  PermissionKind,
  { label: string; intent: DtIntent; icon: string }
> = {
  view: { label: '查看', intent: 'neutral', icon: 'eye' },
  manage: { label: '管理', intent: 'primary', icon: 'pencil' },
  operate: { label: '操作', intent: 'warning', icon: 'activity' },
  admin: { label: '高危', intent: 'danger', icon: 'alert-triangle' },
}

const props = defineProps<{ kind: PermissionKind; size?: 'sm' | 'md' }>()

const meta = computed(() => KIND_META[props.kind])
/** 标签尺寸，缺省与 DtTag 同轴取 sm。 */
const tagSize = computed<'sm' | 'md'>(() => props.size ?? 'sm')
/** 图标跟 DtTag 的字号同轴：sm 10px / md 12px。 */
const iconPx = computed(() => (tagSize.value === 'md' ? 12 : 10))
</script>

<template>
  <DtTag :intent="meta.intent" :size="tagSize">
    <DtIcon :name="meta.icon" :size="iconPx" />{{ meta.label }}
  </DtTag>
</template>
