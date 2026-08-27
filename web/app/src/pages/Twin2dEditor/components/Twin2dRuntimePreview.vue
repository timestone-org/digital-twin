<script setup lang="ts">
/**
 * @fileoverview 画布角上的画中画：按这块 2D 孪生在大屏上的宽高比，用运行态那一条
 * 渲染链画当前草稿。编辑画布是编辑态（把手、网格、命中带都在），这里画的才是它上了
 * 大屏之后的样子——所见即所得的最后一道验证。
 *
 * ⚠ 走 `ModuleRenderer` 而不是在这里照着运行态再拼一遍：标题条、卡片外观、缩放四档、
 * 逐槽取数四档与联动上抛全长在模块里，拼第二遍必然漂，漂了以后预览里看到的就不是
 * 大屏上的那一份，而两边单看都对。
 * ⚠ 内容按**设计像素**铺开再整体缩放：直接渲染进一个小框的话，同一份配置里的字号与
 * 留白在小框里占的比例远大于大屏上，配得准不准全看不出来。
 * ⚠ 这一页对「自己在编哪个模块」一无所知：模块类型来自节点行，草稿注回的键来自清单，
 * 一个都不写死（`dashboard-module-literals` 与 `moduleTypeLiterals` 两道闸都扫这里）。
 */
import type { BindingView, DashboardNodePayload } from '@dt/contracts'
import { getModule } from '@dt/modules'
import { ModuleRenderer, provideRuntimeData } from '@dt/runtime'
import { TWIN_2D_CONFIG_KEY } from '@dt/twin2d'
import type { Twin2dConfig } from '@dt/twin2d'
import { DtButton, DtNotice } from '@dt/ui'
import { computed, ref } from 'vue'
import type { CSSProperties } from 'vue'

import {
  TWIN_2D_LIVE_STATE_TEXT,
  useTwin2dLiveValues,
} from '../scripts/useTwin2dLiveValues'

const props = defineProps<{
  /** 被编辑的大屏节点；null = 还没读出来。 */
  node: DashboardNodePayload | null
  /**
   * 编辑器内存里的这份配置。
   * ⚠ 必须是**没被编辑态动过**的那一份：编辑器上的临时显隐、选中高亮只属于本次编辑，
   * 套进预览会让「上了大屏到底长什么样」问错人。
   */
  config: Twin2dConfig | null
  /** 当前这一份绑定，含还没保存的草稿。 */
  bindings: readonly BindingView[]
}>()

const live = useTwin2dLiveValues(
  () => props.node?.dashboardId ?? '',
  () => props.bindings,
)

// 预览与运行态共用同一条取数：同一份绑定、同一个读取器、同一个订阅
provideRuntimeData({ readBinding: () => live.readBinding() })

const open = ref(false)
const wide = ref(false)

/** 画中画与放大档各自的上限框（像素）。 */
const LIMITS = {
  pip: { width: 320, height: 220 },
  wide: { width: 760, height: 520 },
} as const

/** 这块孪生在大屏上占多大（设计像素）；取不到尺寸时给 null。 */
const target = computed(() => {
  const node = props.node
  if (node === null || node.w <= 0 || node.h <= 0) return null
  return { width: node.w, height: node.h }
})

/**
 * ⚠ 等比缩进上限框，两轴取同一个倍率：各缩各的话预览会变形，而变形之后
 * 「图在这块格子里是不是塞得下」这件唯一要验的事就白验了。
 * ⚠ 格子比上限框还小时倍率大于 1，照样放大：守的是**比例**不是 1:1。
 */
const box = computed(() => {
  const size = target.value
  if (size === null) return null
  const limit = wide.value ? LIMITS.wide : LIMITS.pip
  const scale = Math.min(limit.width / size.width, limit.height / size.height)
  return {
    width: Math.round(size.width * scale),
    height: Math.round(size.height * scale),
    scale,
  }
})

/**
 * 喂给模块的那一袋：节点上存量的配置，加上把内存里的草稿注回它自己那个键。
 *
 * ⚠ 注回的键先问清单（`subEditor.configKey`）：子编辑器与它编的模块之间只有清单
 * 这一条约定。清单还没声明子编辑器时退回本页读写用的那个键——预览注回的键必须与
 * `nodesWithTwin2d` 写回的键是同一个，否则预览画的是存量配置、保存写的是另一处，
 * 而两边都不报错。
 * ⚠ 模块没注册就整块不画：`ModuleRenderer` 那时只会摆一句「未知模块类型」，
 * 让人以为是这张图坏了。
 */
const preview = computed(() => {
  const node = props.node
  const draft = props.config
  if (node === null || draft === null) return null
  const manifest = getModule(node.moduleType)
  if (manifest === undefined) return null
  const key = manifest.subEditor?.configKey ?? TWIN_2D_CONFIG_KEY
  return {
    nodeId: node.id,
    moduleType: node.moduleType,
    config: { ...node.configJson, [key]: draft },
  }
})

const boxStyle = computed<CSSProperties | undefined>(() =>
  box.value === null
    ? undefined
    : { width: `${box.value.width}px`, height: `${box.value.height}px` },
)

/** 内容按设计像素铺开，再整体缩到画中画那么大。 */
const stageStyle = computed<CSSProperties | undefined>(() => {
  const size = target.value
  const current = box.value
  if (size === null || current === null) return undefined
  return {
    width: `${size.width}px`,
    height: `${size.height}px`,
    transform: `scale(${current.scale})`,
    transformOrigin: 'top left',
  }
})

const sizeLabel = computed(() => {
  const size = target.value
  return size === null ? '' : `${size.width} × ${size.height}`
})

/** 取数取不取得到，照实写一句；绑了点位就把「收到几个」也报出来。 */
const liveLabel = computed(() => {
  const text = TWIN_2D_LIVE_STATE_TEXT[live.state.value]
  const { bound, received } = live.tally.value
  return bound === 0 ? text : `${text} · ${received}/${bound}`
})
</script>

<template>
  <div class="twin2d-preview">
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

    <div v-else class="twin2d-preview__panel">
      <header class="twin2d-preview__bar">
        <span class="twin2d-preview__name">运行态预览</span>
        <span class="twin2d-preview__size">{{ sizeLabel }}</span>
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
        class="twin2d-preview__box"
        :style="boxStyle"
        data-test="preview-box"
      >
        <div class="twin2d-preview__stage" :style="stageStyle">
          <ModuleRenderer
            :module-type="preview.moduleType"
            :config="preview.config"
            :bindings="bindings"
            :node-id="preview.nodeId"
            :get-manifest="getModule"
          />
        </div>
      </div>
      <DtNotice v-else intent="neutral" data-test="preview-blocked">
        这块在大屏上的尺寸或模块取不到，预览不了。
      </DtNotice>

      <p
        class="twin2d-preview__live"
        :data-state="live.state.value"
        data-test="preview-live"
      >
        {{ liveLabel }}
      </p>
    </div>
  </div>
</template>

<style scoped lang="scss">
.twin2d-preview {
  position: absolute;
  top: 12px;
  right: 12px;
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

  // 尺寸把两个按钮推到右头，读数与标题不会挤在一起
  &__size {
    flex: 1;
    font-size: 11px;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }

  // ⚠ 必须裁掉，且 `flex: none` 一个都不能少：里面那层按设计像素铺开，缩放前比这个框
  // 大得多；而它是列向 flex 的一项，不锁 shrink 的话外面一挤就把定高压掉，
  // 预览于是按一个谁也没配过的比例取景
  &__box {
    position: relative;
    flex: none;
    overflow: hidden;
    background: var(--surface-sunken);
  }

  &__stage {
    position: absolute;
    top: 0;
    left: 0;
  }

  // 取数四档里只有「在推」是常态，其余三档都要显眼一点
  &__live {
    max-width: 320px;
    padding: 4px 10px 6px;
    font-size: 11px;
    color: var(--state-warning);
    border-top: 1px solid var(--border-subtle);

    &[data-state='live'] {
      color: var(--text-secondary);
    }
  }
}
</style>
