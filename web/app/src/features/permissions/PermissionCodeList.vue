<script setup lang="ts">
/**
 * @fileoverview 只读地按目录分组列出一个主体持有的权限码。
 *
 * ⚠ 目录里查不到的码归入尾部「其他」原样展示：静默丢弃会让这里的码数少于
 * 列表行上铺出来的码数，一个会自己少显示权限的授权界面比不显示更危险。
 */
import { computed } from 'vue'
import type { PermissionGroup, PermissionItem } from '@dt/contracts'
import { DtTag } from '@dt/ui'

import { hasRisk, riskTag } from './riskTags'

const props = defineProps<{
  codes: readonly string[]
  groups: readonly PermissionGroup[]
}>()

interface HeldGroup {
  code: string
  label: string
  items: readonly PermissionItem[]
}

/** 只保留命中的条目；命中数为 0 的分组整组不出现。 */
const held = computed<HeldGroup[]>(() => {
  const owned = new Set(props.codes)
  const found: HeldGroup[] = []
  for (const group of props.groups) {
    const items = group.items.filter((item) => owned.has(item.code))
    if (items.length > 0) {
      found.push({ code: group.code, label: group.label, items })
    }
  }
  return found
})

const orphans = computed(() => {
  const known = new Set(
    props.groups.flatMap((group) => group.items.map((item) => item.code)),
  )
  return props.codes.filter((code) => !known.has(code))
})
</script>

<template>
  <div class="flex flex-col gap-5">
    <p v-if="codes.length === 0" class="m-0 text-xs text-text-secondary">
      这个角色没有任何权限码，持有它的账号只能访问免码路由。
    </p>

    <section v-for="group in held" :key="group.code">
      <h3 class="m-0 mb-2 text-xs font-semibold text-text-secondary">
        {{ group.label }}
      </h3>
      <ul class="m-0 flex list-none flex-col gap-2 p-0">
        <li
          v-for="item in group.items"
          :key="item.code"
          class="flex items-baseline gap-2"
        >
          <span class="min-w-0 text-xs text-text-primary">{{ item.name }}</span>
          <code class="ml-auto font-mono text-2xs text-text-disabled">{{
            item.code
          }}</code>
          <DtTag
            v-if="hasRisk(item.kind)"
            class="shrink-0"
            :intent="riskTag(item.kind).intent"
          >
            {{ riskTag(item.kind).label }}
          </DtTag>
        </li>
      </ul>
    </section>

    <section v-if="orphans.length > 0">
      <h3 class="m-0 mb-2 text-xs font-semibold text-text-secondary">其他</h3>
      <ul class="m-0 flex list-none flex-wrap gap-2 p-0">
        <li v-for="code in orphans" :key="code">
          <code class="font-mono text-2xs text-text-disabled">{{ code }}</code>
        </li>
      </ul>
    </section>
  </div>
</template>
