<script setup lang="ts">
/**
 * @fileoverview 样式那一栏的装配：把当下生效的那一份样式喂给 `StyleInspector`，
 * 并把它留的两个具名插槽填上——图元树选中的那一枚交给 `PrimFields`，变体表整列
 * 交给 `VariantFields`，外加一枚「加一条变体」。
 *
 * ⚠ 收的是**当下生效**的那一份样式（`twin2dNodeStyleOf`：文档里的优先，落不到才回
 *   预置库）。喂预置库那一份会把已有的覆盖整个抹掉，而界面上只表现为「刚才改的几项
 *   一起没了」（§13.4）。
 * ⚠ 两条样式轴各有各的检查器：节点样式那一副带图元树与变体，连线样式那一副带描边、
 *   走线与两端标记。硬塞同一副面的话每一格都写不回去，且一处都不报错。
 * ⚠ 图元字段与变体逐键写回一律走**合并撤销**，在控件 `blur` 时断段：每敲一个字母压
 *   一帧的话，撤销键按二十下才退得回一个词。合并键带上样式 id 与那一枚的身份，
 *   不带的话改完 A 接着改 B，两笔会并进同一帧。
 * ⚠ 取点那一路本层不给 `canPick`：画布还接不住取点请求，给了就是一枚按下去毫无
 *   反应的键（`PrimFields` 的口径）。
 * ⚠ 预览钉在这一栏顶上，画的是**当下生效**的那一份——一份刚新建、画布上还没有节点在用
 *   的样式，除了这里没有第二个地方看得见它长什么样。样式编辑面自带一张更大的，那边
 *   给 `showPreview: false` 关掉这一张，两张一起摆会把配置挤出屏外。
 */
import type {
  Twin2dConfig,
  Twin2dEdgeStyle,
  Twin2dNodeStyle,
  Twin2dPrim,
  Twin2dVariant,
} from '@dt/twin2d'
import { DtButton, DtEmpty } from '@dt/ui'
import { computed } from 'vue'

import type { Twin2dStyleFocus } from '../../scripts/editorSelection'
import type { Twin2dOrderMove } from '../../scripts/nodeOps'
import { findTwin2dPrim, updatePrim } from '../../scripts/primOps'
import {
  addVariant,
  orderVariants,
  removeVariant,
  twin2dEdgeStyleOf,
  twin2dNodeStyleOf,
  updateVariant,
} from '../../scripts/styleOps'
import type { Twin2dVariantSeed } from '../../scripts/styleOps'
import Twin2dStylePreview from '../Twin2dStylePreview.vue'
import EdgeStyleInspector from './EdgeStyleInspector.vue'
import PrimFields from './PrimFields.vue'
import StyleInspector from './StyleInspector.vue'
import VariantFields from './VariantFields.vue'

const props = withDefaults(
  defineProps<{
    /** 整份配置；改动整份产出往上 emit。 */
    config: Twin2dConfig
    /** 正在编辑哪一份样式。 */
    focus: Twin2dStyleFocus
    /** 图元树上选中的那一枚；空串 = 一枚都没选。 */
    selectedPrim: string
    /** 顶上那张预览画不画；样式编辑面自带一张更大的，那边关掉这一张。 */
    showPreview?: boolean
  }>(),
  { showPreview: true },
)

const emit = defineEmits<{
  /** 一次性改动，落一帧撤销。 */
  change: [config: Twin2dConfig]
  /** 连续输入：同 `key` 的连着并成一帧。 */
  merge: [config: Twin2dConfig, key: string]
  /** 焦点离开输入框，这一段连续输入到此为止。 */
  endMerge: []
  /** 图元树上选中了一枚；空串 = 取消选中。 */
  pickPrim: [primId: string]
  /** 图元树上按了复制；剪贴板归页面持有，本层只转发。 */
  copyPrim: []
  /** 图元树上按了粘贴；同上。 */
  pastePrim: []
}>()

/** 新变体的种子：一条判得出的条件，否则归一化会把整条丢掉。 */
const NEW_VARIANT: Twin2dVariantSeed = {
  when: { kind: 'status', in: ['alarm'] },
}

const nodeStyle = computed<Twin2dNodeStyle | null>(() =>
  props.focus.kind === 'styles'
    ? twin2dNodeStyleOf(props.config, props.focus.id)
    : null,
)

const edgeStyle = computed<Twin2dEdgeStyle | null>(() =>
  props.focus.kind === 'edgeStyles'
    ? twin2dEdgeStyleOf(props.config, props.focus.id)
    : null,
)

/** 图元树上选中的那一枚；选中的那枚已经不在了也落到 null。 */
const prim = computed<Twin2dPrim | null>(() => {
  const style = nodeStyle.value
  if (style === null || props.selectedPrim === '') return null
  return findTwin2dPrim(style.prims, props.selectedPrim)?.prim ?? null
})

const variants = computed<readonly Twin2dVariant[]>(
  () => nodeStyle.value?.variants ?? [],
)

/**
 * 连续输入的一帧：合并键带上样式 id 与那一段的身份。
 * @param next 整份新配置
 * @param what 这一段连续输入的身份（图元 id、变体 id）
 */
function mergeOut(next: Twin2dConfig, what: string): void {
  if (next !== props.config)
    emit('merge', next, `style:${props.focus.id}:${what}`)
}

/**
 * 改一枚图元。
 * @param next 整枚新图元
 */
function onPrim(next: Twin2dPrim): void {
  const style = nodeStyle.value
  if (style === null) return
  mergeOut(updatePrim(props.config, style, next), `prim:${next.id}`)
}

/**
 * 改一条变体。
 * @param next 整条新变体
 */
function onVariant(next: Twin2dVariant): void {
  const style = nodeStyle.value
  if (style === null) return
  mergeOut(updateVariant(props.config, style, next), `variant:${next.id}`)
}

/**
 * 调一条变体的次序；变体按文档序求值、后者覆盖前者，所以这一步就是改渲染结果。
 * @param variantId 要动的那一条
 * @param move 四档层序
 */
function onMove(variantId: string, move: Twin2dOrderMove): void {
  const style = nodeStyle.value
  if (style === null) return
  const next = orderVariants(props.config, style, variantId, move)
  if (next !== props.config) emit('change', next)
}

/**
 * 删一条变体。
 * @param variantId 要删的那一条
 */
function onRemoveVariant(variantId: string): void {
  const style = nodeStyle.value
  if (style === null) return
  const next = removeVariant(props.config, style, variantId)
  if (next !== props.config) emit('change', next)
}

/** 加一条变体，追加在末尾（= 最后求值、覆盖前面几条）。 */
function onAddVariant(): void {
  const style = nodeStyle.value
  if (style === null) return
  const added = addVariant(props.config, style, NEW_VARIANT)
  if (added.id !== null) emit('change', added.config)
}

function onEndMerge(): void {
  emit('endMerge')
}

/**
 * 样式面自己那些格子的连续输入原样往上抛。
 * @param next 整份新配置
 * @param key 这一段连续输入的标识
 */
function onMerge(next: Twin2dConfig, key: string): void {
  emit('merge', next, key)
}
</script>

<template>
  <div data-test="style-pane" :data-kind="focus.kind">
    <Twin2dStylePreview
      v-if="showPreview && nodeStyle !== null"
      class="mb-3"
      :node-style="nodeStyle"
    />

    <StyleInspector
      v-if="nodeStyle !== null"
      :node-style="nodeStyle"
      :config="config"
      :selected-prim="selectedPrim"
      @change="emit('change', $event)"
      @merge="onMerge"
      @end-merge="onEndMerge"
      @pick-prim="emit('pickPrim', $event)"
      @copy-prim="emit('copyPrim')"
      @paste-prim="emit('pastePrim')"
    >
      <template #prim>
        <PrimFields
          v-if="prim !== null"
          class="mt-2"
          :model-value="prim"
          data-test="style-pane-prim"
          @update:model-value="onPrim"
          @blur="onEndMerge"
        />
      </template>

      <template #variants>
        <div class="flex flex-col gap-2" data-test="style-pane-variants">
          <VariantFields
            v-for="(variant, seat) in variants"
            :key="variant.id"
            :model-value="variant"
            :prims="nodeStyle.prims"
            :order="seat"
            :total="variants.length"
            class="rounded border border-border-subtle p-2"
            :data-test="`style-pane-variant-${variant.id}`"
            @update:model-value="onVariant"
            @move="onMove(variant.id, $event)"
            @blur="onEndMerge"
          />
          <div class="flex items-center gap-1">
            <DtButton
              size="xs"
              variant="outline"
              intent="primary"
              icon="plus"
              data-test="style-pane-add-variant"
              @click="onAddVariant"
            >
              加一条变体
            </DtButton>
            <DtButton
              v-for="variant in variants"
              :key="variant.id"
              size="xs"
              variant="ghost"
              intent="danger"
              icon="trash"
              :aria-label="`删掉变体 ${variant.id}`"
              :title="`删掉变体 ${variant.id}`"
              :data-test="`style-pane-drop-${variant.id}`"
              @click="onRemoveVariant(variant.id)"
            />
          </div>
        </div>
      </template>
    </StyleInspector>

    <EdgeStyleInspector
      v-else-if="edgeStyle !== null"
      :edge-style="edgeStyle"
      :config="config"
      @change="emit('change', $event)"
      @merge="onMerge"
      @end-merge="onEndMerge"
    />

    <DtEmpty
      v-else
      size="inline"
      icon="palette"
      title="这份样式已经不在了"
      hint="它可能刚被删掉，或者从别的图里带过来时没落地。"
      data-test="style-pane-empty"
    />
  </div>
</template>
