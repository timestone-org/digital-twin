<script setup lang="ts">
/**
 * @fileoverview 按分组勾选权限码。角色权限、用户直权、路由规则三处共用。
 *
 * ⚠ 语义是**覆盖**不是追加：`modelValue` 就是最终集合。三处的调用方都必须把
 * 「当前有哪些」先填进来，否则提交上去就是把已有授权清空。
 */
import type { PermissionGroup } from '@dt/contracts'
import { DtCheckbox, DtTag } from '@dt/ui'

import { hasRisk, riskTag } from './riskTags'

const props = withDefaults(
  defineProps<{
    groups: readonly PermissionGroup[]
    modelValue: ReadonlySet<string>
    /** 已由别处授予、这里改不动的码（如角色带来的），只读展示。 */
    locked?: ReadonlySet<string> | undefined
    lockedLabel?: string
  }>(),
  { lockedLabel: '已含' },
)

const emit = defineEmits<{ 'update:modelValue': [value: Set<string>] }>()

function toggle(code: string, checked: boolean): void {
  const next = new Set(props.modelValue)
  if (checked) next.add(code)
  else next.delete(code)
  emit('update:modelValue', next)
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <section v-for="group in groups" :key="group.code">
      <h3 class="m-0 mb-2 text-xs font-semibold text-text-secondary">
        {{ group.label }}
      </h3>
      <ul class="m-0 flex list-none flex-col gap-2 p-0">
        <li
          v-for="item in group.items"
          :key="item.code"
          class="flex items-center justify-between gap-3"
        >
          <DtCheckbox
            :model-value="modelValue.has(item.code)"
            :disabled="locked?.has(item.code) ?? false"
            @update:model-value="toggle(item.code, $event)"
          >
            <span class="text-[13px] text-text-primary">{{ item.name }}</span>
            <code class="ml-2 text-2xs text-text-disabled">{{
              item.code
            }}</code>
          </DtCheckbox>
          <DtTag v-if="locked?.has(item.code)" intent="primary">
            {{ lockedLabel }}
          </DtTag>
          <DtTag
            v-else-if="hasRisk(item.kind)"
            :intent="riskTag(item.kind).intent"
          >
            {{ riskTag(item.kind).label }}
          </DtTag>
        </li>
      </ul>
    </section>
  </div>
</template>
