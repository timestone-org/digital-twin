<script setup lang="ts">
/**
 * @fileoverview 节点级的两件事：追加图元（`layers`）与按图元 id 覆盖样式里的图元
 * （`patch`）。
 *
 * ⚠ 传感器药丸也住在 `layers` 里，这里**不列它**：药丸是「图元 + 读数槽位」两半，
 *   在这里删掉图元那一半，槽位会留在节点上永远没人读，而界面上看不出来。要动它去
 *   传感器那一段。
 * ⚠ 覆盖补丁是**浅覆盖**，「不覆盖」与「覆盖成缺省值」是两回事：所以清一格用的是
 *   把那个键整个去掉，而不是写一个 undefined 进去。
 * ⚠ 这里不新建图元：造一枚图元要摊开十几个基类字段，那是样式编辑面的事；节点这一层
 *   只管把样式给的东西挪一挪、藏一藏。
 */
import { TWIN_2D_SENSOR_DEFS, twin2dSensorIdPrefix } from '@dt/twin2d'
import type { Twin2dPlacement, Twin2dPrim, Twin2dPrimPatch } from '@dt/twin2d'
import { DtButton, DtEmpty, DtNumberInput, DtSelect } from '@dt/ui'
import { computed } from 'vue'

import { TWIN_2D_UNIT_RANGE } from '../../scripts/inspectorFields'
import {
  TWIN_2D_PRIM_KIND_LABELS,
  twin2dPatchOptions,
} from '../../scripts/primTreeRows'
import PlacementField from '../fields/PlacementField.vue'

const props = defineProps<{
  /** 节点级追加图元。 */
  layers: readonly Twin2dPrim[]
  /** 节点级覆盖补丁：键是被覆盖的图元 id。 */
  patch: Readonly<Record<string, Twin2dPrimPatch>>
  /** 这个节点用的样式的图元树，供「新增覆盖」入口列举。 */
  stylePrims: readonly Twin2dPrim[]
}>()

const emit = defineEmits<{
  /** 追加图元与覆盖补丁一起换；`mergeKey` 非空表示这是一段连续输入里的一帧。 */
  update: [
    readonly Twin2dPrim[],
    Readonly<Record<string, Twin2dPrimPatch>>,
    string | null,
  ]
  /** 一段连续输入到此为止。 */
  blur: []
}>()

/** 传感器药丸的图元 id；这一段一律跳过它们。 */
const SENSOR_PILL_IDS: ReadonlySet<string> = new Set(
  TWIN_2D_SENSOR_DEFS.map((def) => `${twin2dSensorIdPrefix(def)}-pill`),
)

/** 「显示」这一格的三档：不覆盖 / 强制显示 / 强制隐藏。 */
const SHOW_OPTIONS = [
  { value: '', label: '不覆盖' },
  { value: 'show', label: '强制显示' },
  { value: 'hide', label: '强制隐藏' },
]

/** 药丸之外的追加图元。 */
const rows = computed(() =>
  props.layers.filter((prim) => !SENSOR_PILL_IDS.has(prim.id)),
)

const patchRows = computed(() =>
  Object.entries(props.patch).map(([primId, value]) => ({
    primId,
    // ⚠ 整条补丁跟着行走：在写回那一步再按 id 查一次表，就多出一条界面上到不了的
    //   兜底分支，而兜底分支永远测不到
    patch: value,
    hidden: value.hidden === undefined ? '' : value.hidden ? 'hide' : 'show',
    opacity: value.opacity,
  })),
)

/** 样式里还没被覆盖的那些图元。 */
const patchable = computed(() =>
  twin2dPatchOptions(props.stylePrims, props.patch),
)

/**
 * 换一份追加图元，补丁原样带上。
 * @param layers 新的追加图元
 * @param mergeKey 连续输入的段标识；一次性改动给 null
 */
function writeLayers(
  layers: readonly Twin2dPrim[],
  mergeKey: string | null,
): void {
  emit('update', layers, props.patch, mergeKey)
}

/**
 * 换一份覆盖补丁，追加图元原样带上。
 * @param patch 新的覆盖补丁
 * @param mergeKey 连续输入的段标识；一次性改动给 null
 */
function writePatch(
  patch: Readonly<Record<string, Twin2dPrimPatch>>,
  mergeKey: string | null,
): void {
  emit('update', props.layers, patch, mergeKey)
}

/**
 * 挪一枚追加图元的落点。
 * @param id 图元 id
 * @param at 新落点
 */
function setLayerAt(id: string, at: Twin2dPlacement): void {
  writeLayers(
    props.layers.map((prim) => (prim.id === id ? { ...prim, at } : prim)),
    `layer-at:${id}`,
  )
}

/**
 * 改一枚追加图元的不透明度。
 * @param id 图元 id
 * @param opacity 0..1
 */
function setLayerOpacity(id: string, opacity: number): void {
  writeLayers(
    props.layers.map((prim) => (prim.id === id ? { ...prim, opacity } : prim)),
    `layer-opacity:${id}`,
  )
}

/**
 * 删掉一枚追加图元。
 * @param id 图元 id
 */
function removeLayer(id: string): void {
  writeLayers(
    props.layers.filter((prim) => prim.id !== id),
    null,
  )
}

/**
 * 给样式里的一枚图元加一条空覆盖，之后逐格往里填。
 * @param primId 样式里那枚图元的 id
 */
function addPatch(primId: string): void {
  if (props.patch[primId] !== undefined) return
  writePatch({ ...props.patch, [primId]: {} }, null)
}

/**
 * 撤掉整条覆盖。
 * @param primId 被覆盖的图元 id
 */
function clearPatch(primId: string): void {
  const kept = new Map(
    Object.entries(props.patch).filter(([key]) => key !== primId),
  )
  writePatch(Object.fromEntries(kept), null)
}

/**
 * 去掉补丁里的一格。
 * ⚠ 删键而不是写一个缺省值进去：浅覆盖里「不覆盖」与「覆盖成缺省值」是两回事，
 * 后者会把样式改过的那一格一起按回缺省。
 * @param patch 这一条覆盖
 * @param key 要去掉的那一格
 */
function withoutOne(
  patch: Twin2dPrimPatch,
  key: 'hidden' | 'opacity',
): Twin2dPrimPatch {
  const next = { ...patch }
  delete next[key]
  return next
}

/**
 * 覆盖一格；`next` 给 null 表示把这一格整个去掉。
 * @param primId 被覆盖的图元 id
 * @param next 这一条覆盖的新内容
 * @param mergeKey 连续输入的段标识；一次性改动给 null
 */
function writeOne(
  primId: string,
  next: Twin2dPrimPatch,
  mergeKey: string | null,
): void {
  writePatch({ ...props.patch, [primId]: next }, mergeKey)
}

/**
 * 覆盖「显示」这一格。
 * @param primId 被覆盖的图元 id
 * @param current 这一条覆盖现在的样子
 * @param choice 三档之一
 */
function setPatchHidden(
  primId: string,
  current: Twin2dPrimPatch,
  choice: string,
): void {
  if (choice === '') {
    writeOne(primId, withoutOne(current, 'hidden'), null)
    return
  }
  writeOne(primId, { ...current, hidden: choice === 'hide' }, null)
}

/**
 * 覆盖「不透明度」这一格；清空即撤掉这一格的覆盖。
 * @param primId 被覆盖的图元 id
 * @param current 这一条覆盖现在的样子
 * @param opacity 0..1；undefined = 不覆盖
 */
function setPatchOpacity(
  primId: string,
  current: Twin2dPrimPatch,
  opacity: number | undefined,
): void {
  if (opacity === undefined) {
    writeOne(primId, withoutOne(current, 'opacity'), null)
    return
  }
  writeOne(primId, { ...current, opacity }, `patch-opacity:${primId}`)
}
</script>

<template>
  <div class="flex flex-col gap-2" @focusout="emit('blur')">
    <DtEmpty
      v-if="rows.length === 0"
      size="inline"
      title="没有节点级追加图元"
      hint="传感器药丸算在传感器那一段里。"
      data-test="layer-empty"
    />

    <div
      v-for="prim in rows"
      :key="prim.id"
      class="flex flex-col gap-1.5 rounded border border-border-subtle bg-surface-sunken p-2"
      :data-test="`layer-row-${prim.id}`"
    >
      <div class="flex items-center gap-1">
        <span class="min-w-0 flex-1 truncate text-xs text-text-secondary">
          {{ prim.id }} · {{ TWIN_2D_PRIM_KIND_LABELS[prim.kind] }}
        </span>
        <DtButton
          size="xs"
          variant="ghost"
          intent="danger"
          icon="trash"
          aria-label="删除这枚图元"
          title="删除这枚图元"
          :data-test="`layer-remove-${prim.id}`"
          @click="removeLayer(prim.id)"
        />
      </div>

      <PlacementField
        :model-value="prim.at"
        :data-test="`layer-at-${prim.id}`"
        @update:model-value="setLayerAt(prim.id, $event)"
      />

      <DtNumberInput
        :model-value="prim.opacity"
        :range="TWIN_2D_UNIT_RANGE"
        label="不透明度"
        size="sm"
        :steppers="false"
        :data-test="`layer-opacity-${prim.id}`"
        @update:model-value="setLayerOpacity(prim.id, $event ?? 1)"
      />
    </div>

    <div
      v-for="row in patchRows"
      :key="row.primId"
      class="flex flex-col gap-1.5 rounded border border-border-subtle bg-surface-sunken p-2"
      :data-test="`patch-row-${row.primId}`"
    >
      <div class="flex items-center gap-1">
        <span class="min-w-0 flex-1 truncate text-xs text-text-secondary">
          覆盖 {{ row.primId }}
        </span>
        <DtButton
          size="xs"
          variant="ghost"
          intent="danger"
          icon="trash"
          aria-label="撤掉这条覆盖"
          title="撤掉这条覆盖"
          :data-test="`patch-clear-${row.primId}`"
          @click="clearPatch(row.primId)"
        />
      </div>

      <DtSelect
        :model-value="row.hidden"
        :options="SHOW_OPTIONS"
        label="显示"
        size="sm"
        :data-test="`patch-hidden-${row.primId}`"
        @update:model-value="setPatchHidden(row.primId, row.patch, $event)"
      />

      <DtNumberInput
        :model-value="row.opacity"
        :range="TWIN_2D_UNIT_RANGE"
        label="不透明度"
        hint="留空 = 这一格不覆盖"
        size="sm"
        :steppers="false"
        :data-test="`patch-opacity-${row.primId}`"
        @update:model-value="setPatchOpacity(row.primId, row.patch, $event)"
      />
    </div>

    <DtSelect
      v-if="patchable.length > 0"
      model-value=""
      :options="patchable"
      :display="{ placeholder: '覆盖样式里的一枚图元…' }"
      size="sm"
      aria-label="覆盖样式里的一枚图元"
      data-test="patch-add"
      @update:model-value="addPatch"
    />
  </div>
</template>
