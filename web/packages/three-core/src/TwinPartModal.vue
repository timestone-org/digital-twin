<script setup lang="ts">
/**
 * @fileoverview 部件详情弹窗：近距点击某个部件时弹出来的那一个。左边是装配栏
 * （这个部件收着的后代），右边是当前看的那一个的模型与读数。
 *
 * ⚠ 弹窗里那块 3D 是**另一套场景**，不是把主画布挪过来：它自己起渲染器、把部件
 * 克隆一份摆在原点。所以「只看这一个」不需要去动主场景的显隐与材质，关掉弹窗
 * 也就没有任何要还原的东西。
 * ⚠ 框级的两项（弹窗宽度、模型区高度）取**打开的那个部件**，内容级的取当前看的
 * 那一个：逐行换宽高会让对话框在屏幕上跳。
 * ⚠ 数据卡片由 `panelCard` 命令式建 DOM 而不是在模板里重画一遍：八种字段画法、
 * 阈值档与迷你图都长在那边，照着抄第二遍必然漂，而漂了以后两边都不报错。
 */
import type {
  TwinPart,
  TwinPartFieldValues,
  TwinPartValues,
} from '@dt/twin-config'
import { detailPanelOf, partAssembly } from '@dt/twin-config'
import { DtModal } from '@dt/ui'
import type * as THREE from 'three'
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type CSSProperties,
} from 'vue'

import { createFrameClock } from './frameClock'
import {
  buildPanelCard,
  paintPanelField,
  type PanelFieldView,
} from './panelCard'
import { createPartPreview, type PartPreview } from './partPreview'
import type { SceneRendererFactory } from './sceneCore'
import TwinPartAssemblyRail from './TwinPartAssemblyRail.vue'

const props = defineProps<{
  /** 打开的那个部件，也是装配的顶；null = 弹窗关着。 */
  part: TwinPart | null
  /** 全部部件；装配清单按它建。 */
  parts: readonly TwinPart[]
  /** 装配栏里正看着谁；空串 = 看打开的那个自己。 */
  currentId: string
  /** 详情字段实时值，键是 `<部件 id>::<字段 key>`。 */
  values: TwinPartFieldValues
  /** 部件状态染色那一路，装配栏的连接轨用它上色。 */
  partValues: TwinPartValues
  /** 取这个部件在模型里的对象；模型没加载时给空数组。 */
  objectsOf: (partId: string) => readonly THREE.Object3D[]
  /** 渲染器工厂；测试里换成 headless 替身。 */
  rendererFactory?: SceneRendererFactory
}>()

const emit = defineEmits<{ close: []; select: [partId: string] }>()

const stageRef = ref<HTMLDivElement | null>(null)
const cardRef = ref<HTMLDivElement | null>(null)
/** 当前这张卡片的字段落点；换部件时整批换掉。 */
let views: PanelFieldView[] = []
let preview: PartPreview | null = null
let observer: ResizeObserver | null = null
let frameHandle = 0
const clock = createFrameClock()
/** 说要画模型，模型里却一个对应节点都找不到。 */
const stageEmpty = ref(false)

const isOpen = computed(() => props.part !== null)

/** 这个部件与它的全部后代，深度优先；只有它自己时不摆装配栏。 */
const assembly = computed(() =>
  props.part === null ? [] : partAssembly(props.parts, props.part.id),
)
const hasAssembly = computed(() => assembly.value.length > 1)

/**
 * 现在看的是哪个部件。
 * ⚠ 找不到就退回打开的那一个，绝不给 null：弹窗开着而当前件是空的话，卡片与
 * 画布整份不建，而屏幕上只是一块空白。
 */
const current = computed<TwinPart | null>(() => {
  const root = props.part
  if (root === null) return null
  const hit = assembly.value.find((node) => node.part.id === props.currentId)
  return hit?.part ?? root
})
const currentPartId = computed(() => current.value?.id ?? '')

const title = computed(() => {
  const part = current.value
  if (part === null) return ''
  return part.detail.title === '' ? part.name : part.detail.title
})

/** 主题色空着就跟随大屏，不在这里塞一个默认色。 */
const bodyStyle = computed<CSSProperties>(() => {
  const root = props.part
  const detail = current.value?.detail
  if (root === null || detail === undefined) return {}
  const accent = detail.accent
  return {
    '--tp-stage-height': `${root.detail.modelHeight}px`,
    ...(accent === ''
      ? {}
      : {
          '--tp-accent': accent.startsWith('--') ? `var(${accent})` : accent,
        }),
  }
})

const width = computed(() => `${props.part?.detail.width ?? 0}px`)
const showModel = computed(() => current.value?.detail.showModel === true)
const noFields = computed(() => current.value?.detail.fields.length === 0)

/** 舞台上克隆哪些对象：当前件自己，加上它收着的全部后代。 */
function stageObjects(part: TwinPart): readonly THREE.Object3D[] {
  return partAssembly(props.parts, part.id).flatMap((node) =>
    props.objectsOf(node.part.id),
  )
}

function paint(): void {
  for (const view of views) paintPanelField(view, props.values)
}

function clearCard(): void {
  cardRef.value?.replaceChildren()
  views = []
}

function buildCard(): void {
  const host = cardRef.value
  const part = current.value
  clearCard()
  if (host === null || part === null || part.detail.fields.length === 0) return
  const card = buildPanelCard(detailPanelOf(part))
  views = card.fields
  host.append(card.card)
  paint()
}

function measure(): void {
  const stage = stageRef.value
  if (stage === null) return
  preview?.measure(stage.clientWidth, stage.clientHeight)
}

function tick(now: number): void {
  preview?.frame(clock.tick(now))
  frameHandle = requestAnimationFrame(tick)
}

function stopPreview(): void {
  // ⚠ 没在跑就别叫：`cancelAnimationFrame(0)` 虽然无害，但会让「卸载时到底停了
  //   几个循环」这类断言数不清是谁停的
  if (frameHandle !== 0) cancelAnimationFrame(frameHandle)
  frameHandle = 0
  observer?.disconnect()
  observer = null
  preview?.dispose()
  preview = null
  stageEmpty.value = false
}

function startPreview(): void {
  const stage = stageRef.value
  const part = current.value
  if (stage === null || part === null || !part.detail.showModel) return
  const objects = stageObjects(part)
  stageEmpty.value = objects.length === 0
  if (objects.length === 0) return
  preview = createPartPreview({
    container: stage,
    objects,
    autoRotate: part.detail.autoRotate,
    ...(props.rendererFactory === undefined
      ? {}
      : { renderer: props.rendererFactory }),
  })
  if (preview === null) return
  observer = new ResizeObserver(measure)
  observer.observe(stage)
  measure()
  clock.reset()
  frameHandle = requestAnimationFrame(tick)
}

/**
 * 换部件（或开关弹窗、在装配栏里换一行）时整份重来。
 * ⚠ 必须 `flush: 'post'`：弹窗的 DOM 由 `v-if` 建出来，默认时机跑的话两个 ref
 * 都还是 null，卡片与画布整份不建——而它不报任何错。
 * ⚠ 换配置时主场景会重建部件材质，预览里克隆的那份材质随之作废，所以这里按
 * **部件引用**重来而不是只在开关时重来。
 */
function rebuild(): void {
  stopPreview()
  buildCard()
  startPreview()
}

watch(current, rebuild, { flush: 'post' })
watch(() => props.values, paint)

// ⚠ 不用 `immediate: true` 代替这一句：那一档是在 setup 里同步跑的，那时弹窗的
// DOM 还没建出来，两个 ref 都是 null，卡片与画布整份不建——而它不报任何错
onMounted(rebuild)

onBeforeUnmount(() => {
  stopPreview()
  clearCard()
})
</script>

<template>
  <DtModal
    :model-value="isOpen"
    :title="title"
    :description="current?.detail.subtitle ?? ''"
    :width="width"
    @update:model-value="emit('close')"
  >
    <div class="twin-part-modal" :style="bodyStyle">
      <div
        class="twin-part-modal__grid"
        :class="{ 'is-split': hasAssembly }"
        data-test="part-modal-grid"
      >
        <TwinPartAssemblyRail
          v-if="hasAssembly"
          :nodes="assembly"
          :current-id="currentPartId"
          :values="partValues"
          @select="emit('select', $event)"
        />
        <div class="twin-part-modal__detail">
          <div
            v-show="showModel && !stageEmpty"
            ref="stageRef"
            class="twin-part-modal__stage"
            data-test="part-modal-stage"
          />
          <p
            v-if="showModel && stageEmpty"
            class="twin-part-modal__stage twin-part-modal__blank"
            data-test="part-modal-stage-empty"
          >
            模型里找不到这个部件的节点
          </p>
          <div
            v-show="!noFields"
            ref="cardRef"
            class="twin-part-modal__data"
            data-test="part-modal-data"
          />
          <p
            v-if="noFields"
            class="twin-part-modal__data twin-part-modal__blank"
            data-test="part-modal-no-fields"
          >
            这个部件没有配读数
          </p>
        </div>
      </div>
    </div>
  </DtModal>
</template>

<style scoped lang="scss">
// ⚠ 数据卡片的观感全在全局的 `styles/panel.scss` 里：它是命令式建出来的 DOM，
// 不在本组件的 scoped 作用域内，写在这里一条都不生效。
.twin-part-modal {
  --tp-accent: var(--accent-primary);
  --tp-bg: var(--surface-overlay);
  --tp-font-size: 12px;

  // 装配栏塌不塌成一条要看**弹窗自己**有多宽，不是看视口：弹窗宽度是配出来的，
  // 一块 320px 的窄弹窗在大屏幕上照样摆不下左右两栏
  container-type: inline-size;
  color: var(--text-primary);
  font-size: var(--tp-font-size);
  line-height: 1.5;

  &__grid {
    display: grid;
    gap: 16px;
    align-items: start;

    &.is-split {
      grid-template-columns: 176px minmax(0, 1fr);
    }
  }

  &__detail {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    align-items: flex-start;
    min-width: 0;
  }

  // ⚠ 富余的宽度全给舞台，读数卡只按内容取一个稳定宽度：反过来的话，把弹窗
  //   调宽只是把卡片摊得更开，而设备大多是长条形的，缺的正是舞台的宽度
  &__stage {
    position: relative;
    flex: 1 1 360px;
    height: var(--tp-stage-height, 260px);
    overflow: hidden;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--surface-sunken);
  }

  &__data {
    flex: 0 1 320px;
    min-width: 240px;
  }

  &__blank {
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0;
    padding: 20px 12px;
    border: 1px dashed var(--border-default);
    border-radius: var(--radius-md);
    background: none;
    color: var(--text-disabled);
    text-align: center;
  }
}

@container (max-width: 620px) {
  .twin-part-modal__grid.is-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
