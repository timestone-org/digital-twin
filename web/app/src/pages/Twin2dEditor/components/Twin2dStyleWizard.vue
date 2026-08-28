<script setup lang="ts">
/**
 * @fileoverview 样式编辑面：左边整套配置、右边一张跟着改的预览，新建 / 复制 / 就地改
 * 外观三条入口都落在这里，好在库还开着的时候把一份自定义样式改到位。
 *
 * ⚠ 左栏直接复用 `StylePane`，不另摆一套字段：另摆一套就是同一份样式有两处写入口，
 *   两边对「什么时候落一份覆盖」的判断一旦漂开，界面上只表现为「在这儿改的没生效」。
 * ⚠ 本层一个字都不落文档：改动整份产出照 `StylePane` 的三档（一次性 / 合并 / 断段）
 *   原样上抛，撤销栈仍归页面那一个 `commit` 持有。在这里拦一层自己的草稿，撤销键就
 *   退不回这一段里的任何一步。
 * ⚠ 图元剪贴板那两支也照直上抛：剪贴板与「选中的是哪一枚图元」都归页面持有，在这里
 *   另起一份本地选中的话，⌘C / ⌘V 与面上那两枚键操作的会是两枚不同的图元。
 * ⚠ `layer="confirm"`：本面叠在样式库抽屉之上，同一层的弹窗 z-index 相同、谁在上全看
 *   挂载次序，抽屉挂得早就会把它整个盖住（`DtModal` 的口径）。
 */
import type { Twin2dConfig, Twin2dNodeStyle } from '@dt/twin2d'
import { DtButton, DtEmpty, DtModal } from '@dt/ui'
import { computed } from 'vue'

import type { Twin2dStyleFocus } from '../scripts/editorSelection'
import { twin2dNodeStyleOf } from '../scripts/styleOps'
import StylePane from './inspector/StylePane.vue'
import Twin2dStylePreview from './Twin2dStylePreview.vue'

/** 右栏那张预览框的边长（CSS 像素）。 */
const PREVIEW_BOX = { w: 320, h: 232 }

const props = defineProps<{
  /** 开着没有。 */
  open: boolean
  /** 整份配置；本层只读，改动一律整份上抛。 */
  config: Twin2dConfig
  /** 正在编辑哪一份节点样式。 */
  styleId: string
  /** 图元树上选中的那一枚；空串 = 一枚都没选。归页面持有，与 ⌘C / ⌘V 同一份。 */
  selectedPrim: string
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
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

const focus = computed<Twin2dStyleFocus>(() => ({
  kind: 'styles',
  id: props.styleId,
}))

/** 当下生效的那一份：文档里的优先，落不到才回预置库（§13.4）。 */
const nodeStyle = computed<Twin2dNodeStyle | null>(() =>
  twin2dNodeStyleOf(props.config, props.styleId),
)

function close(): void {
  emit('update:open', false)
}
</script>

<template>
  <DtModal
    :model-value="open"
    title="编辑样式"
    description="左边改、右边看：变体与状态得切到那一档上才看得见效果。"
    width="60rem"
    layer="confirm"
    data-test="style-wizard"
    @update:model-value="emit('update:open', $event)"
  >
    <div class="t2sw-grid">
      <div class="t2sw-config" data-test="style-wizard-config">
        <StylePane
          :config="config"
          :focus="focus"
          :selected-prim="selectedPrim"
          :show-preview="false"
          @change="emit('change', $event)"
          @merge="(next, key) => emit('merge', next, key)"
          @end-merge="emit('endMerge')"
          @pick-prim="emit('pickPrim', $event)"
          @copy-prim="emit('copyPrim')"
          @paste-prim="emit('pastePrim')"
        />
      </div>

      <div class="t2sw-preview" data-test="style-wizard-preview">
        <Twin2dStylePreview
          v-if="nodeStyle !== null"
          :node-style="nodeStyle"
          :box="PREVIEW_BOX"
        />
        <DtEmpty
          v-else
          size="inline"
          icon="palette"
          title="这份样式已经不在了"
          hint="它可能刚被删掉。"
          data-test="style-wizard-empty"
        />
      </div>
    </div>

    <template #footer>
      <DtButton variant="outline" intent="neutral" @click="close">
        完成
      </DtButton>
    </template>
  </DtModal>
</template>

<style scoped lang="scss">
.t2sw-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 21rem;
  gap: 12px;
  align-items: start;
}

// 配置那一栏自己滚：整个弹窗一起滚的话右边那张预览会跟着滚出视野，
// 而「边改边看」正是要它一直在
.t2sw-config {
  overflow-y: auto;
  max-height: 60vh;
  padding-right: 4px;
}

// ⚠ 预览钉在顶上：不钉的话左栏滚到图元树那一段时右边是一片空白
.t2sw-preview {
  position: sticky;
  top: 0;
}

// 窄屏落回上下两段，预览摆在前面
@media (width <= 60rem) {
  .t2sw-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .t2sw-preview {
    position: static;
    order: -1;
  }
}
</style>
