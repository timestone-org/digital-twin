<script setup lang="ts">
/**
 * @fileoverview 工作台的「我的权限」卡：计数、角色来源、码清单。
 * 只做展示，取数在页面里。
 */
import { DtCard, DtTag } from '@dt/ui'

defineProps<{
  stats: readonly { key: string; label: string; value: number }[]
  roleName: string
  roleCodes: readonly string[]
  directCodes: readonly string[]
}>()
</script>

<template>
  <DtCard title="我的权限" icon="key-round" corners>
    <dl class="mb-4 grid grid-cols-3 gap-3" aria-label="权限计数">
      <div
        v-for="stat in stats"
        :key="stat.key"
        class="rounded-md border border-border-subtle bg-surface-sunken px-3 py-2"
      >
        <dd
          class="font-display m-0 text-xl font-semibold text-accent-secondary"
        >
          {{ stat.value }}
        </dd>
        <dt class="m-0 text-2xs text-text-disabled">{{ stat.label }}</dt>
      </div>
    </dl>

    <p class="m-0 mb-2 text-[13px] leading-relaxed text-text-secondary">
      角色权限来自
      <strong class="font-medium text-text-primary">{{ roleName }}</strong>
      ，单独授予的直权叠加在它之上。
    </p>

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

    <p v-if="directCodes.length" class="m-0 mt-3 text-2xs text-text-disabled">
      高亮的是直权：它绕过角色单独授予，改派角色也带不走。
    </p>
  </DtCard>
</template>
