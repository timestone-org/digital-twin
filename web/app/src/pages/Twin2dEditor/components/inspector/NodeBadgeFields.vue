<script setup lang="ts">
/**
 * @fileoverview 节点左上角标那三项：字面量、形状与底色。
 *
 * ⚠ 角标画不画由**字面量空不空**定（预置图元的显示条件是 `field: 'badge'` 的
 *   `present`）：形状与底色配了也不会让一枚角标凭空出现，所以这三项摆在一起，
 *   字面量在最前。
 * ⚠ 自己不碰文档：产出一份补丁往上抛，由节点检查器合进整份配置。文本与颜色带着
 *   合并段标识走，逐键各记一帧的话敲一个角标就往撤销栈里塞进十几格。
 */
import { TWIN_2D_BADGE_SHAPES } from '@dt/twin2d'
import type { Twin2dBadgeShape, Twin2dNode } from '@dt/twin2d'
import { DtInput, DtSelect } from '@dt/ui'

import { enumOptions } from '../../scripts/inspectorFields'
import ColorField from '../fields/ColorField.vue'

/** 这三项里改动的那几个。 */
type BadgePatch = Partial<
  Pick<Twin2dNode, 'badge' | 'badgeColor' | 'badgeShape'>
>

const props = defineProps<{
  /** 角标上的字；空串 = 不画角标。 */
  badge: string
  /** 角标底色；空串 = 用节点的强调色。 */
  badgeColor: string
  badgeShape: Twin2dBadgeShape
}>()

const emit = defineEmits<{
  /** 换一份角标字段；`mergeKey` 非空表示这是一段连续输入里的一帧。 */
  update: [BadgePatch, string | null]
  /** 一段连续输入到此为止。 */
  blur: []
}>()

const SHAPE_LABELS: Readonly<Record<Twin2dBadgeShape, string>> = {
  round: '药丸',
  square: '方角',
  diamond: '菱形',
}

const SHAPE_OPTIONS = enumOptions(TWIN_2D_BADGE_SHAPES, SHAPE_LABELS)

/**
 * 换角标形状；认不出的取值与当前这一档都不写回。
 * @param value 下拉给出的取值
 */
function setShape(value: string): void {
  const badgeShape = TWIN_2D_BADGE_SHAPES.find((item) => item === value)
  if (badgeShape === undefined || badgeShape === props.badgeShape) return
  emit('update', { badgeShape }, null)
}
</script>

<template>
  <div class="flex flex-col gap-1.5" @focusout="emit('blur')">
    <DtInput
      :model-value="badge"
      label="角标"
      placeholder="留空 = 不画角标"
      hint="有字才画；形状与底色只管它长什么样"
      size="sm"
      data-test="node-badge"
      @update:model-value="emit('update', { badge: $event }, 'badge')"
    />
    <DtSelect
      :model-value="badgeShape"
      :options="SHAPE_OPTIONS"
      label="角标形状"
      size="sm"
      data-test="node-badge-shape"
      @update:model-value="setShape"
    />
    <ColorField
      :model-value="badgeColor"
      label="角标底色"
      hint="留空 = 用节点的强调色"
      @update:model-value="emit('update', { badgeColor: $event }, 'badgeColor')"
    />
  </div>
</template>
