<script setup lang="ts">
/**
 * @fileoverview 视口右下角的画中画：按这块孪生在大屏上的宽高比，用运行态那一条
 * 渲染链画当前草稿——看到的就是它最终在大屏上的样子。
 *
 * ⚠ 走 `ModuleRenderer` 而不是在这里照着运行态再拼一遍：标题、场景工具条、
 * 结构树、钻取面板、按距离的显隐与自动旋转全都长在模块里，拼第二遍必然漂，
 * 漂了以后预览里看到的就不是大屏上的那一份。
 * ⚠ 内容按**设计像素**铺开再整体缩放：直接渲染进一个小框的话，16px 的标题
 * 在小框里占的比例远大于大屏上，字号、边距这类配置全看不准。
 * ⚠ 只在打开时挂载：3D 预览自带一个 WebGL 上下文并把模型再解析一遍，
 * 常挂着等于整页把模型显存吃两份。
 */
import type { BindingView, DashboardNodePayload } from '@dt/contracts'
import { getModule } from '@dt/modules'
import {
  ModuleRenderer,
  provideRuntimeData,
  type BindingValueReader,
} from '@dt/runtime'
import type { TwinConfig } from '@dt/twin-config'
import { DtButton, DtNotice } from '@dt/ui'
import { computed, ref, type CSSProperties } from 'vue'

import { twinRuntimePreviewOf } from '../scripts/runtimePreview'
import {
  isUsableTargetSize,
  previewBoxOf,
  type TwinTargetSize,
} from '../scripts/targetFrame'

const props = defineProps<{
  /** 被编辑的大屏节点；null = 还没读出来。 */
  node: DashboardNodePayload | null
  /**
   * 编辑器内存里的这份配置。
   * ⚠ 必须是不带左栏眼睛那层临时显隐的原配置：眼睛只属于本次编辑，
   * 把它套进预览会让「大屏上到底看不看得见」问错人。
   */
  config: TwinConfig | null
  /** 当前这一份绑定，含还没保存的草稿。 */
  bindings: readonly BindingView[]
  /** 取绑定读取器；每次求值都会重新调它。 */
  readBinding: () => BindingValueReader
}>()

// 预览与编辑视口共用同一条取数：同一份绑定、同一个读取器、同一个订阅
provideRuntimeData({ readBinding: () => props.readBinding() })

const open = ref(false)
const wide = ref(false)

/** 画中画与放大档各自的上限框（像素）。 */
const LIMITS = {
  pip: { width: 320, height: 220 },
  wide: { width: 760, height: 520 },
} as const

const target = computed<TwinTargetSize | undefined>(() =>
  props.node === null
    ? undefined
    : { width: props.node.w, height: props.node.h },
)

const box = computed(() => {
  const size = target.value
  if (!isUsableTargetSize(size)) return null
  return previewBoxOf(size, wide.value ? LIMITS.wide : LIMITS.pip)
})

const preview = computed(() =>
  twinRuntimePreviewOf(props.node, props.config, getModule),
)

const boxStyle = computed<CSSProperties | undefined>(() =>
  box.value === null
    ? undefined
    : { width: `${box.value.width}px`, height: `${box.value.height}px` },
)

/** 内容按设计像素铺开，再整体缩到画中画那么大。 */
const stageStyle = computed<CSSProperties | undefined>(() => {
  const size = target.value
  const current = box.value
  if (size === undefined || current === null) return undefined
  return {
    width: `${size.width}px`,
    height: `${size.height}px`,
    transform: `scale(${current.scale})`,
    transformOrigin: 'top left',
  }
})

const sizeLabel = computed(() => {
  const size = target.value
  return size === undefined ? '' : `${size.width} × ${size.height}`
})
</script>

<template>
  <div class="twin-preview">
    <DtButton
      v-if="!open"
      size="sm"
      variant="soft"
      intent="neutral"
      icon="eye"
      data-test="open-preview"
      @click="open = true"
    >
      运行态预览
    </DtButton>

    <div v-else class="twin-preview__panel">
      <header class="twin-preview__bar">
        <span class="twin-preview__name">运行态预览</span>
        <span class="twin-preview__size">{{ sizeLabel }}</span>
        <DtButton
          size="xs"
          variant="ghost"
          intent="neutral"
          :icon="wide ? 'minus' : 'plus'"
          :aria-label="wide ? '收回画中画' : '放大画中画'"
          :title="wide ? '收回画中画' : '放大画中画'"
          data-test="toggle-wide"
          @click="wide = !wide"
        />
        <DtButton
          size="xs"
          variant="ghost"
          intent="neutral"
          icon="close"
          aria-label="关掉预览"
          title="关掉预览"
          data-test="close-preview"
          @click="open = false"
        />
      </header>

      <div
        v-if="preview !== null && box !== null"
        class="twin-preview__box"
        :style="boxStyle"
        data-test="preview-box"
      >
        <div class="twin-preview__stage" :style="stageStyle">
          <ModuleRenderer
            :module-type="preview.moduleType"
            :config="preview.config"
            :bindings="bindings"
            :node-id="preview.nodeId"
            :get-manifest="getModule"
          />
        </div>
      </div>
      <DtNotice v-else intent="neutral">
        这块在大屏上的尺寸或模块取不到，预览不了。
      </DtNotice>
    </div>
  </div>
</template>

<style scoped lang="scss">
.twin-preview {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: var(--z-sticky);

  &__panel {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--surface-raised);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    box-shadow: var(--fx-shadow-menu);
  }

  &__bar {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 4px 4px 4px 10px;
    border-bottom: 1px solid var(--border-subtle);
  }

  &__name {
    font-size: 12px;
    color: var(--text-primary);
  }

  // 尺寸推开两个按钮，读数与标题不会挤在一起
  &__size {
    flex: 1;
    font-size: 11px;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }

  // ⚠ 必须裁掉：里面那层按设计像素铺开，缩放前比这个框大得多
  &__box {
    position: relative;
    overflow: hidden;
    background: var(--surface-sunken);
  }

  &__stage {
    position: absolute;
    top: 0;
    left: 0;
  }
}
</style>
