<script setup lang="ts">
/**
 * @fileoverview 角色卡：身份 + 内置与账号数两条关键事实 + 权限码区 + 底部操作。
 *
 * 权限码可能是几十个，故按「计数 → 前几枚 → 就地展开 → 只读弹窗」四级递进
 * 披露；卡内只做计数与字典序截断，按目录分组只出现在拿得到目录的弹窗里。
 */
import { computed } from 'vue'
import type { RoleSummary } from '@dt/contracts'
import { DtCard, DtTag } from '@dt/ui'

import CodeChips from '../../components/CodeChips.vue'
import { sortCodes } from '../../scripts/codes'
import RoleRowActions from './RoleRowActions.vue'

const props = defineProps<{ role: RoleSummary }>()

const emit = defineEmits<{
  edit: [role: RoleSummary]
  codes: [role: RoleSummary]
  clone: [role: RoleSummary]
  remove: [role: RoleSummary]
}>()

const codes = computed(() => sortCodes(props.role.permissions))

/** 不可改这件事写在人找配置入口的地方，而不是躲在按钮 title 里。 */
const codesLabel = computed(() =>
  props.role.is_builtin ? '权限码（内置角色不可修改）' : '权限码',
)
</script>

<template>
  <DtCard padding="sm" class="role-card flex flex-col">
    <template #header>
      <div class="flex w-full min-w-0 items-start justify-between gap-2">
        <div class="min-w-0">
          <h2
            class="m-0 truncate font-display text-sm font-semibold text-text-title"
            :title="role.name"
          >
            {{ role.name }}
          </h2>
          <p
            class="m-0 truncate text-2xs text-text-disabled"
            :title="role.description ?? ''"
          >
            {{ role.description || '未填写描述' }}
          </p>
        </div>
        <DtTag
          v-if="role.is_builtin"
          class="shrink-0"
          size="md"
          intent="primary"
        >
          内置
        </DtTag>
      </div>
    </template>

    <div class="flex flex-1 flex-col gap-3">
      <div class="flex items-baseline justify-between gap-2">
        <span class="text-3xs text-text-disabled">账号数</span>
        <!-- 它同时预告删除的结局：>0 时后端会拒 -->
        <span
          class="text-xs"
          :class="
            role.user_count === 0
              ? 'text-text-disabled'
              : 'font-mono text-text-secondary'
          "
        >
          {{ role.user_count === 0 ? '无账号' : role.user_count }}
        </span>
      </div>

      <div class="min-w-0">
        <div class="flex items-baseline justify-between gap-2">
          <span class="min-w-0 text-3xs text-text-disabled">
            {{ codesLabel }}
          </span>
          <span class="shrink-0 whitespace-nowrap text-3xs text-text-disabled"
            >共 {{ role.permissions.length }} 个</span
          >
        </div>
        <CodeChips
          class="mt-2"
          :codes="codes"
          :max="6"
          empty="尚未配置权限码"
        />
      </div>

      <div class="mt-auto border-t border-border-subtle pt-2">
        <RoleRowActions
          :role="role"
          @codes="emit('codes', $event)"
          @clone="emit('clone', $event)"
          @edit="emit('edit', $event)"
          @remove="emit('remove', $event)"
        />
      </div>
    </div>
  </DtCard>
</template>
