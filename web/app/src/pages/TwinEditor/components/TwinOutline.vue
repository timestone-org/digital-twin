<script setup lang="ts">
/**
 * @fileoverview 左栏大纲树：八个分组列出场景里的一切，管选中、增删、复制、
 * 重排与显隐。它自己不改文档，只抛事件，改配置一律由页面交给 `entityOps`。
 * ⚠ 行上标的序号就是文档序，而文档序决定数组绑定的对齐（`anchorValues[2]`
 * 喂第 3 个锚点）——上移下移会连带改变相邻两行的取值来源。
 */
import type { TwinConfig } from '@dt/twin-config'
import { DtIcon } from '@dt/ui'
import { computed, ref } from 'vue'

import { buildTwinOutline, twinRemoveImpactText } from '../scripts/outlineNodes'
import type {
  TwinOutlineRow,
  TwinOutlineSection,
} from '../scripts/outlineNodes'
import { isSameSelection } from '../scripts/types'
import type { TwinEntityKind, TwinSelection } from '../scripts/types'

const props = defineProps<{
  config: TwinConfig
  selection: TwinSelection | null
  /** 有诊断问题的实体 id 集合，树上打红点。 */
  flaggedIds: ReadonlySet<string>
}>()

const emit = defineEmits<{
  select: [TwinSelection]
  add: [TwinEntityKind]
  /** 从模型节点批量建部件。 */
  bulkAdd: []
  remove: [{ kind: TwinEntityKind; id: string }]
  duplicate: [{ kind: TwinEntityKind; id: string }]
  move: [{ kind: TwinEntityKind; id: string; delta: number }]
  toggleVisible: [{ kind: TwinEntityKind; id: string }]
}>()

/** 行内图标键的样式，五个键共用一串。 */
const ACT =
  'flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-disabled hover:text-accent-primary disabled:cursor-not-allowed disabled:opacity-30'

const collapsed = ref<ReadonlySet<string>>(new Set())
/** 正在等二次确认的那一行；同一时刻只有一行。 */
const pendingRemoveKey = ref<string | null>(null)

const sections = computed(() =>
  buildTwinOutline(props.config, props.flaggedIds),
)

function toggleSection(key: string): void {
  const next = new Set(collapsed.value)
  if (!next.delete(key)) next.add(key)
  collapsed.value = next
}

function selectSection(section: TwinOutlineSection): void {
  if (section.selection !== null) emit('select', section.selection)
}

function isSectionSelected(section: TwinOutlineSection): boolean {
  if (section.selection === null) return false
  return isSameSelection(props.selection, section.selection)
}

function isRowSelected(row: TwinOutlineRow): boolean {
  return isSameSelection(props.selection, { kind: row.kind, id: row.id })
}

function addTo(kind: TwinEntityKind | null): void {
  if (kind !== null) emit('add', kind)
}

/** 删除前那句「会连带影响什么」；空串表示删了不牵连别人。 */
function removeImpact(row: TwinOutlineRow): string {
  return twinRemoveImpactText(props.config, row.kind, row.id)
}

function confirmRemove(row: TwinOutlineRow): void {
  pendingRemoveKey.value = null
  emit('remove', { kind: row.kind, id: row.id })
}
</script>

<template>
  <div class="flex flex-col gap-1 p-1" data-test="twin-outline">
    <template v-for="section in sections" :key="section.key">
      <button
        v-if="section.selection !== null"
        type="button"
        class="flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-xs"
        :class="
          isSectionSelected(section)
            ? 'bg-surface-raised text-accent-on-surface'
            : 'text-text-secondary hover:bg-surface-raised'
        "
        data-test="outline-single"
        :data-key="section.key"
        @click="selectSection(section)"
      >
        <DtIcon :name="section.icon" :size="13" />
        <span class="truncate">{{ section.title }}</span>
      </button>

      <div v-else class="rounded-[var(--radius-sm)]">
        <div class="flex items-center gap-1 px-1" data-test="outline-section">
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left text-xs font-medium text-text-secondary hover:text-text-primary"
            :aria-expanded="!collapsed.has(section.key)"
            :aria-label="`展开或折叠${section.title}`"
            :data-key="section.key"
            @click="toggleSection(section.key)"
          >
            <DtIcon
              :name="
                collapsed.has(section.key) ? 'chevron-right' : 'chevron-down'
              "
              :size="12"
            />
            <DtIcon :name="section.icon" :size="12" />
            <span class="truncate">{{ section.title }}</span>
            <span class="text-3xs text-text-disabled">{{
              section.rows.length
            }}</span>
          </button>
          <!-- 一个模型几十个节点，逐个建部件再逐个填节点名是这里最费手的一段 -->
          <button
            v-if="section.kind === 'parts'"
            type="button"
            :class="ACT"
            aria-label="从模型节点批量建部件"
            title="从模型节点批量建部件"
            data-test="section-bulk"
            @click="emit('bulkAdd')"
          >
            <DtIcon name="layers" :size="12" />
          </button>
          <button
            type="button"
            :class="ACT"
            :aria-label="`新增${section.title}`"
            :title="`新增${section.title}`"
            data-test="section-add"
            @click="addTo(section.kind)"
          >
            <DtIcon name="plus" :size="12" />
          </button>
        </div>

        <template v-if="!collapsed.has(section.key)">
          <p
            v-if="section.rows.length === 0"
            class="px-2 py-1 text-3xs text-text-disabled"
          >
            还没有{{ section.title }}
          </p>
          <template v-for="row in section.rows" :key="row.key">
            <div
              class="flex items-center gap-0.5 rounded-[var(--radius-sm)] pr-1 text-xs"
              :class="
                isRowSelected(row)
                  ? 'bg-surface-raised text-accent-on-surface'
                  : 'text-text-secondary hover:bg-surface-raised'
              "
              data-test="outline-row"
              :data-id="row.id"
            >
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-1.5 px-1 py-1 text-left"
                data-test="row-select"
                @click="emit('select', { kind: row.kind, id: row.id })"
              >
                <!-- 序号不是装饰：数组绑定按这个位次对齐 -->
                <span
                  class="w-4 shrink-0 text-right text-3xs text-text-disabled"
                  title="文档序号，数组绑定按它对齐"
                >
                  {{ row.index }}
                </span>
                <DtIcon :name="row.icon" :size="12" />
                <span class="min-w-0 flex-1 truncate">{{ row.label }}</span>
                <span
                  v-if="row.meta !== ''"
                  class="shrink-0 text-3xs text-text-disabled"
                >
                  {{ row.meta }}
                </span>
                <span
                  v-if="row.flagged"
                  class="h-1.5 w-1.5 shrink-0 rounded-full bg-state-danger"
                  title="这一项有配置问题"
                  data-test="row-flag"
                />
              </button>
              <button
                v-if="row.visible !== null"
                type="button"
                :class="ACT"
                :aria-label="`${row.visible ? '隐藏' : '显示'}${row.label}`"
                data-test="row-visible"
                @click="emit('toggleVisible', { kind: row.kind, id: row.id })"
              >
                <DtIcon :name="row.visible ? 'eye' : 'eye-off'" :size="12" />
              </button>
              <button
                type="button"
                :class="ACT"
                :disabled="!row.canMoveUp"
                :aria-label="`上移${row.label}`"
                data-test="row-up"
                @click="emit('move', { kind: row.kind, id: row.id, delta: -1 })"
              >
                <DtIcon name="chevron-up" :size="12" />
              </button>
              <button
                type="button"
                :class="ACT"
                :disabled="!row.canMoveDown"
                :aria-label="`下移${row.label}`"
                data-test="row-down"
                @click="emit('move', { kind: row.kind, id: row.id, delta: 1 })"
              >
                <DtIcon name="chevron-down" :size="12" />
              </button>
              <button
                type="button"
                :class="ACT"
                :aria-label="`复制${row.label}`"
                data-test="row-copy"
                @click="emit('duplicate', { kind: row.kind, id: row.id })"
              >
                <DtIcon name="copy" :size="12" />
              </button>
              <button
                type="button"
                :class="ACT"
                :aria-label="`删除${row.label}`"
                data-test="row-remove"
                @click="pendingRemoveKey = row.key"
              >
                <DtIcon name="trash" :size="12" />
              </button>
            </div>
            <!-- 二次确认就地展开：连带影响写在这里，弹窗会把它挪出用户的视线 -->
            <div
              v-if="pendingRemoveKey === row.key"
              class="flex flex-wrap items-center gap-1 rounded-[var(--radius-sm)] bg-surface-raised px-2 py-1 text-3xs text-text-secondary"
              data-test="row-remove-confirm"
            >
              <span>删除「{{ row.label }}」？</span>
              <span v-if="removeImpact(row) !== ''" class="text-state-danger">
                {{ removeImpact(row) }}
              </span>
              <button
                type="button"
                class="rounded-[var(--radius-sm)] px-1.5 py-0.5 text-state-danger hover:bg-state-danger/10"
                data-test="row-remove-yes"
                @click="confirmRemove(row)"
              >
                确认删除
              </button>
              <button
                type="button"
                class="rounded-[var(--radius-sm)] px-1.5 py-0.5 hover:text-text-primary"
                data-test="row-remove-no"
                @click="pendingRemoveKey = null"
              >
                取消
              </button>
            </div>
          </template>
        </template>
      </div>
    </template>
  </div>
</template>
