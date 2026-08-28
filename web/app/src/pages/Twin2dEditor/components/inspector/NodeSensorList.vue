<script setup lang="ts">
/**
 * @fileoverview 节点上的传感器药丸：四种预置传感器（TT/FT/PT/LT）各一枚，落点走
 * 九档锚点。
 *
 * ⚠ 一枚药丸是**两半**：`layers` 里的那棵图元，与 `slots` 里的那条读数槽位。两半
 *   必须同进同出——只加图元不加槽位，墙上永远是占位符；只删槽位不删图元，那枚药丸
 *   留在图上再也接不到值。两种都零报错，所以增删只有这里一个出口。
 * ⚠ 落点交给 `PlacementField`，九档锚点一档不少：参考项目的编辑器只给四档
 *   （`AnchorId = 'l' | 'r' | 't' | 'b'`），手写 `'c'` 渲染得出来却在面板上选不到，
 *   于是下一次动这枚药丸就把它丢了。
 * ⚠ 一种传感器在一个节点上只有一枚：药丸的图元 id 与读数槽键都由种类推出，第二枚
 *   与第一枚同 id、同槽键，归一化时被整条丢弃，而界面上看不出少了什么。
 */
import {
  TWIN_2D_SENSOR_DEFAULT_AT,
  TWIN_2D_SENSOR_DEFS,
  twin2dSensorIdPrefix,
  twin2dSensorSlot,
  twin2dShippedSensorPill,
} from '@dt/twin2d'
import type {
  Twin2dPlacement,
  Twin2dPrim,
  Twin2dSensorDef,
  Twin2dSlot,
} from '@dt/twin2d'
import { DtCheckbox } from '@dt/ui'
import { computed } from 'vue'

import PlacementField from '../fields/PlacementField.vue'

const props = defineProps<{
  /** 节点级追加图元；药丸就住在这里。 */
  layers: readonly Twin2dPrim[]
  /** 节点级追加槽位；一枚药丸带一条。 */
  slots: readonly Twin2dSlot[]
}>()

const emit = defineEmits<{
  /**
   * 图元与槽位一起换；`mergeKey` 非空表示这是一段连续输入里的一帧。
   * ⚠ 两半分两次 emit 会在中间那一帧留下「有药丸没槽位」的文档。
   */
  update: [readonly Twin2dPrim[], readonly Twin2dSlot[], string | null]
  /** 一段连续输入到此为止。 */
  blur: []
}>()

/**
 * 一枚药丸在 `layers` 里的图元 id。
 * ⚠ 与药丸工厂拼出来的那个逐字相同；对不上的表现是勾选框永远显示未启用、
 * 而每按一次就往图上多摞一枚药丸。
 * @param def 这一种传感器的身份
 */
function pillIdOf(def: Twin2dSensorDef): string {
  return `${twin2dSensorIdPrefix(def)}-pill`
}

/** 面板上的一行：这一种传感器在不在，以及它落在哪儿。 */
interface SensorRow {
  def: Twin2dSensorDef
  /** 这枚药丸的图元；null = 这个节点上没有这一种。 */
  prim: Twin2dPrim | null
  at: Twin2dPlacement
}

const rows = computed<readonly SensorRow[]>(() =>
  TWIN_2D_SENSOR_DEFS.map((def) => {
    const prim = props.layers.find((item) => item.id === pillIdOf(def)) ?? null
    return { def, prim, at: prim?.at ?? TWIN_2D_SENSOR_DEFAULT_AT }
  }),
)

/**
 * 加一枚药丸：图元落进 `layers`，读数槽位落进 `slots`。
 * ⚠ 槽键已经在册就不再加一条：样式里自带同键槽位时，重复的那条归一化会丢，
 * 而丢掉的可能正是带着单位与精度的那一份。
 * ⚠ 走**出厂尺度**那一支而不是 `twin2dSensorPill`：后者是参考尺度（§7.8 那份逐像素
 * 谱锁着它），拿它落进图里会让新加的药丸比同一张图上已有的大一号，而两边单看都对。
 * @param def 这一种传感器的身份
 */
function add(def: Twin2dSensorDef): void {
  const pill = twin2dShippedSensorPill(
    def,
    TWIN_2D_SENSOR_DEFAULT_AT,
    twin2dSensorIdPrefix(def),
  )
  const slots = props.slots.some((slot) => slot.key === def.slotKey)
    ? props.slots
    : [...props.slots, twin2dSensorSlot(def)]
  emit('update', [...props.layers, pill], slots, null)
}

/**
 * 撤掉一枚药丸：图元与读数槽位一起走。
 * @param def 这一种传感器的身份
 */
function remove(def: Twin2dSensorDef): void {
  const pillId = pillIdOf(def)
  emit(
    'update',
    props.layers.filter((item) => item.id !== pillId),
    props.slots.filter((slot) => slot.key !== def.slotKey),
    null,
  )
}

/**
 * 勾选框：勾上加一枚，取消撤一枚。
 * @param def 这一种传感器的身份
 * @param on 勾上了没有
 */
function toggle(def: Twin2dSensorDef, on: boolean): void {
  if (on) add(def)
  else remove(def)
}

/**
 * 换一枚药丸的落点；九档锚点、周长贴边与绝对定位都从这里进来。
 * @param def 这一种传感器的身份
 * @param at 新落点
 */
function moveTo(def: Twin2dSensorDef, at: Twin2dPlacement): void {
  const pillId = pillIdOf(def)
  emit(
    'update',
    props.layers.map((item) => (item.id === pillId ? { ...item, at } : item)),
    props.slots,
    `sensor-at:${def.id}`,
  )
}
</script>

<template>
  <div class="flex flex-col gap-1.5" @focusout="emit('blur')">
    <div
      v-for="row in rows"
      :key="row.def.id"
      class="flex flex-col gap-1.5 rounded border border-border-subtle bg-surface-sunken p-2"
      :data-test="`sensor-row-${row.def.id}`"
    >
      <DtCheckbox
        :model-value="row.prim !== null"
        :label="`${row.def.id} · ${row.def.label}`"
        :data-test="`sensor-toggle-${row.def.id}`"
        @update:model-value="toggle(row.def, $event)"
      />
      <p class="text-2xs text-text-disabled">
        读数槽位 {{ row.def.slotKey }} · 单位 {{ row.def.unit }}
      </p>
      <PlacementField
        v-if="row.prim !== null"
        :model-value="row.at"
        :data-test="`sensor-at-${row.def.id}`"
        @update:model-value="moveTo(row.def, $event)"
      />
    </div>
  </div>
</template>
