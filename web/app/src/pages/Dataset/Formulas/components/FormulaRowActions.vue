<script setup lang="ts">
/**
 * @fileoverview 一条库公式行上的操作入口，表格单元格与卡片共用。
 *
 * ⚠ 「引用」**不挂权限码**：改一条公式会波及所有引用它的台账列，谁都该看得见
 * 波及面。写动作一律挂 `formula:manage`——它与 `dataset:manage` 分家是刻意的
 * （docs/DATASET_DESIGN.md §9）。
 * ⚠ 预设只给「恢复出厂口径」，不给删除：删掉之后没有恢复入口，后端也一律 400。
 * ⚠ 行内不开 `explain`：每行挂一句「只读」是纯噪音，页面顶上那一句已经说清了。
 * ⚠ class 要显式落到最外层 div 上——PermGuard 渲染的是插槽 fragment，
 * 自动透传落不下来。
 */
import type { DatasetFormulaDef } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'

const props = defineProps<{ formula: DatasetFormulaDef }>()

const emit = defineEmits<{
  usages: [formula: DatasetFormulaDef]
  edit: [formula: DatasetFormulaDef]
  toggle: [formula: DatasetFormulaDef]
  restore: [formula: DatasetFormulaDef]
  remove: [formula: DatasetFormulaDef]
}>()

defineOptions({ inheritAttrs: false })
</script>

<template>
  <div v-bind="$attrs" class="flex items-center justify-end gap-1">
    <DtButton
      variant="ghost"
      intent="neutral"
      size="sm"
      icon="link"
      aria-label="查看引用"
      title="哪些台账列在用它"
      @click="emit('usages', props.formula)"
    />
    <PermGuard :codes="[PERMISSION_CODES.formulaManage]">
      <DtButton
        variant="ghost"
        intent="neutral"
        size="sm"
        icon="pencil"
        aria-label="编辑公式"
        title="编辑公式"
        @click="emit('edit', props.formula)"
      />
      <DtButton
        variant="ghost"
        intent="neutral"
        size="sm"
        :icon="props.formula.is_enabled ? 'toggle-left' : 'toggle-right'"
        :aria-label="props.formula.is_enabled ? '停用公式' : '启用公式'"
        :title="props.formula.is_enabled ? '停用公式' : '启用公式'"
        @click="emit('toggle', props.formula)"
      />
      <DtButton
        v-if="props.formula.is_builtin"
        variant="ghost"
        intent="neutral"
        size="sm"
        icon="refresh-cw"
        aria-label="恢复出厂口径"
        title="恢复出厂口径（不动启用开关）"
        @click="emit('restore', props.formula)"
      />
      <DtButton
        v-else
        variant="ghost"
        intent="danger"
        size="sm"
        icon="trash"
        aria-label="删除公式"
        title="删除公式"
        @click="emit('remove', props.formula)"
      />
    </PermGuard>
  </div>
</template>
