<script setup lang="ts">
/**
 * @fileoverview 一张大屏的卡片：缩略图 + 悬浮的预览/编辑 + 标题 + 版本与更新时间
 * + 已发布角标 + ⋯ 菜单 + 内联重命名 + 忙碌遮罩。
 *
 * 九个动作分属三个权限码（`cardActions.ts`），组件自己判而不摊成一堆布尔 prop：
 * 摊开就要在页面与卡片两处各维护一张同样的映射表，改一处漏一处的表现是
 * 「⋯ 里点得动，点完被后端弹回」。判定真源仍只有 auth store 一个。
 */
import { computed, ref } from 'vue'
import type { DtMenuItem } from '@dt/contracts'
import { DtButton, DtCard, DtDropdownMenu, DtSpinner, DtTag } from '@dt/ui'

import type { DashboardSummary } from '@/api/dashboardWire'
import { useAuthStore } from '@/stores/auth'
import { formatSince } from '@/utils/datetime'
import {
  CARD_ACTION_CODES,
  CARD_MENU,
  toCardMenuAction,
  type CardMenuAction,
} from '../scripts/cardActions'
import DashboardThumbnail from './DashboardThumbnail.vue'
import { aspectLabel } from '../scripts/ratioPresets'
import InlineRenameField from './InlineRenameField.vue'

const props = withDefaults(
  defineProps<{
    dashboard: DashboardSummary
    busy?: boolean
    busyLabel?: string
  }>(),
  { busy: false, busyLabel: '处理中…' },
)

const emit = defineEmits<{
  preview: []
  share: []
  edit: []
  duplicate: []
  validate: []
  'save-as-template': []
  export: []
  delete: []
  rename: [name: string]
}>()

const auth = useAuthStore()
const isRenaming = ref(false)

/** ⋯ 菜单里的动作分派表；换 switch 只会把圈复杂度顶到上限。 */
const EMIT_ACTION: Record<Exclude<CardMenuAction, 'rename'>, () => void> = {
  share: () => emit('share'),
  edit: () => emit('edit'),
  duplicate: () => emit('duplicate'),
  validate: () => emit('validate'),
  'save-as-template': () => emit('save-as-template'),
  export: () => emit('export'),
  delete: () => emit('delete'),
}

function allows(action: keyof typeof CARD_ACTION_CODES): boolean {
  const codes = CARD_ACTION_CODES[action]
  // 空码数组是「不设门禁」，与 can() 的空集恒假刻意相反，故显式短路
  return codes.length === 0 || auth.can(codes, 'any')
}

const canEdit = computed(() => allows('edit'))

const menuItems = computed<DtMenuItem[]>(() =>
  CARD_MENU.filter((entry) => allows(entry.action)).map((entry) => ({
    value: entry.action,
    label: entry.label,
    icon: entry.icon,
    ...(entry.danger === true ? { danger: true } : {}),
  })),
)

const metaText = computed(
  () =>
    `v${props.dashboard.rowVersion} · 更新 ${formatSince(props.dashboard.updatedAt)}`,
)

const aspect = computed(() =>
  aspectLabel(props.dashboard.designWidth, props.dashboard.designHeight),
)

function onMenuSelect(item: DtMenuItem): void {
  const action = toCardMenuAction(item.value)
  if (action === null) return
  if (action === 'rename') {
    isRenaming.value = true
    return
  }
  EMIT_ACTION[action]()
}

function onRename(name: string): void {
  isRenaming.value = false
  emit('rename', name)
}

/** 卡片空白处点击 = 预览；落在按钮、输入框、菜单项上的点击不算。 */
function onCardClick(event: MouseEvent): void {
  if (props.busy || isRenaming.value) return
  const target = event.target
  if (
    target instanceof Element &&
    target.closest('button,a,input,[role="menuitem"]') !== null
  ) {
    return
  }
  emit('preview')
}
</script>

<template>
  <DtCard
    padding="none"
    class="group relative overflow-hidden"
    :class="{ 'pointer-events-none': busy }"
    data-test="dashboard-card"
    @click="onCardClick"
  >
    <div class="relative">
      <DashboardThumbnail :dashboard-id="dashboard.id" />

      <!-- ⚠ 一并响应 focus-within：只挂 hover 会让键盘焦点落在完全看不见的按钮上 -->
      <div
        v-if="!isRenaming"
        class="absolute inset-0 flex items-center justify-center gap-2 bg-surface-overlay/70 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
      >
        <DtButton
          size="sm"
          variant="soft"
          icon="play"
          data-test="card-preview"
          @click="emit('preview')"
        >
          预览
        </DtButton>
        <DtButton
          v-if="canEdit"
          size="sm"
          icon="pencil"
          data-test="card-edit"
          @click="emit('edit')"
        >
          编辑
        </DtButton>
      </div>

      <!-- 比例角标：缩略图一律 16:9 铺，光看图分不出这张屏是按什么尺寸画的 -->
      <DtTag
        intent="info"
        class="pointer-events-none absolute left-2 top-2"
        data-test="card-aspect"
      >
        {{ aspect }}
      </DtTag>

      <DtTag
        v-if="dashboard.isPublic"
        intent="success"
        class="absolute right-2 top-2"
      >
        已发布
      </DtTag>
    </div>

    <div class="flex items-start gap-2 p-3">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <InlineRenameField
          v-if="isRenaming"
          :value="dashboard.name"
          label="大屏名称"
          @commit="onRename"
          @cancel="isRenaming = false"
        />
        <p v-else class="truncate text-sm font-medium text-text-primary">
          {{ dashboard.name }}
        </p>
        <p class="truncate text-2xs text-text-disabled">{{ metaText }}</p>
      </div>

      <DtDropdownMenu
        v-if="menuItems.length > 0"
        size="sm"
        label="更多操作"
        :items="menuItems"
        @select="onMenuSelect"
      />
    </div>

    <div
      v-if="busy"
      class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-surface-overlay/70"
      data-test="card-busy"
    >
      <DtSpinner :size="24" />
      <span class="text-2xs text-text-secondary">{{ busyLabel }}</span>
    </div>
  </DtCard>
</template>
