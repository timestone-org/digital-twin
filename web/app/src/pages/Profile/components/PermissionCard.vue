<script setup lang="ts">
/** @fileoverview 个人资料页的权限计数、角色来源与权限码清单。 */
import { DtCard, DtTag } from '@dt/ui'

defineProps<{
  stats: readonly { key: string; label: string; value: number }[]
  roleName: string
  roleCodes: readonly string[]
  directCodes: readonly string[]
}>()
</script>

<template>
  <DtCard title="我的权限" icon="key-round">
    <dl
      class="m-0 mb-3 grid grid-cols-3 gap-3 border-b border-border-subtle pb-3"
      aria-label="权限计数"
    >
      <div v-for="stat in stats" :key="stat.key">
        <dt class="m-0 text-2xs text-text-disabled">{{ stat.label }}</dt>
        <dd
          class="m-0 mt-0.5 text-lg font-semibold text-text-title tabular-nums"
        >
          {{ stat.value }}
        </dd>
      </div>
    </dl>

    <div
      class="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-text-secondary"
    >
      <span
        >角色权限来自
        <strong class="font-medium text-text-primary">{{
          roleName
        }}</strong></span
      >
      <span v-if="directCodes.length" class="text-2xs text-text-disabled"
        >高亮标签为单独授予的权限</span
      >
    </div>

    <div class="flex flex-wrap gap-1.5">
      <DtTag v-for="code in roleCodes" :key="`role-${code}`" mono>
        {{ code }}
      </DtTag>
      <DtTag
        v-for="code in directCodes"
        :key="`direct-${code}`"
        intent="primary"
        mono
      >
        {{ code }}
      </DtTag>
      <span
        v-if="roleCodes.length === 0 && directCodes.length === 0"
        class="text-[13px] text-text-disabled"
      >
        当前账号没有任何权限码
      </span>
    </div>
  </DtCard>
</template>
