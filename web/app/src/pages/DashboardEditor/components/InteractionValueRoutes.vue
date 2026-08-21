<script setup lang="ts">
/**
 * @fileoverview 按值跳转的路由列表：一行一个「控件上抛的值 → 跳到哪张大屏」。
 * ⚠ 永远比不中的两种行必须当场标出来（值留空 / 值与上面某条重复），
 * 不标的话表现是「配了一条怎么点都不去的路由」，而配置本身看着完全正常。
 */
import { computed } from 'vue'
import type { InteractionNavigateByValueAction } from '@dt/contracts'
import { DtButton, DtField, DtInput } from '@dt/ui'

import DashboardRefControl from '@/features/dashboard/controls/DashboardRefControl.vue'
import { useRowKeys } from '@/features/dashboard/rowKeys'
import { NAVIGATE_TARGET_FIELD } from '../scripts/interactionOptions'

type ValueRoute = InteractionNavigateByValueAction['routes'][number]

const props = defineProps<{ routes: readonly ValueRoute[] }>()

const emit = defineEmits<{ update: [routes: ValueRoute[]] }>()

const rowKeys = useRowKeys(() => props.routes.length)

/**
 * 逐行算出「这一条永远不会命中」的两种原因。
 * ⚠ 值重复时只标**后面**那条：命中的是第一条，先来的那条一切正常，
 * 两条都标会让人去改一个没毛病的地方。
 * ⚠ 值留空同样永不命中——没带值的事件本就不跳（联动引擎那条口径）。
 */
const rows = computed(() => {
  const seen = new Set<string>()
  return props.routes.map((route, index) => {
    const shadowed = route.value !== '' && seen.has(route.value)
    seen.add(route.value)
    return {
      key: rowKeys.keys.value[index] ?? `route-${index}`,
      route,
      warning:
        route.value === ''
          ? '值留空，这一条永远不会命中'
          : shadowed
            ? '值与上面某条重复，命中的永远是上面那条'
            : '',
    }
  })
})

function add(): void {
  emit('update', [...props.routes, { value: '', target: '' }])
}

function remove(key: string): void {
  const index = rowKeys.indexOf(key)
  if (index < 0) return
  rowKeys.removeAt(index)
  emit(
    'update',
    props.routes.filter((_route, at) => at !== index),
  )
}

function patch(key: string, change: Partial<ValueRoute>): void {
  const index = rowKeys.indexOf(key)
  if (index < 0) return
  emit(
    'update',
    props.routes.map((route, at) =>
      at === index ? { ...route, ...change } : route,
    ),
  )
}

function onValue(key: string, value: string): void {
  patch(key, { value })
}

/** ⚠ 控件在「未选择」时给的是 undefined，落库要收成空串而不是丢键。 */
function onTarget(key: string, raw: unknown): void {
  patch(key, { target: typeof raw === 'string' ? raw : '' })
}
</script>

<template>
  <div
    v-for="row in rows"
    :key="row.key"
    class="flex flex-col gap-1"
    data-test="ix-route"
  >
    <div class="flex items-end gap-2">
      <DtInput
        size="sm"
        label="选中值"
        :model-value="row.route.value"
        placeholder="控件上抛的值"
        data-test="ix-route-value"
        @update:model-value="onValue(row.key, $event)"
      />
      <DtButton
        size="sm"
        variant="ghost"
        intent="danger"
        icon="trash"
        aria-label="删除这一条"
        data-test="ix-route-remove"
        @click="remove(row.key)"
      />
    </div>
    <DtField label="跳到这张大屏" size="sm">
      <DashboardRefControl
        :field="NAVIGATE_TARGET_FIELD"
        :value="row.route.target"
        data-test="ix-route-target"
        @update="onTarget(row.key, $event)"
      />
    </DtField>
    <p
      v-if="row.warning !== ''"
      class="m-0 text-2xs text-status-warning"
      data-test="ix-route-warning"
    >
      {{ row.warning }}
    </p>
  </div>
  <DtButton
    size="sm"
    variant="outline"
    icon="plus"
    data-test="ix-route-add"
    @click="add"
  >
    添加一条
  </DtButton>
</template>
