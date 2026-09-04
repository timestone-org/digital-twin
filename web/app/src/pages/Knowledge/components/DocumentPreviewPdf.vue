<script setup lang="ts">
/**
 * @fileoverview 原件预览的 PDF 画法：pdf.js 逐页画进 canvas，滚到哪画到哪。
 *
 * ⚠ 这个件**只许异步加载**（调用方用 `defineAsyncComponent`）：它第一行就静态
 * 依赖整个 pdf.js，同步引进来会让知识库页每次打开都先下几百 KB，
 * 而多数时候用户根本不点预览。
 *
 * ⚠ 一上来就把每一页都画出来是不行的：一份两百页的手册会当场吃掉几百 MB
 * 显存，而表现是「点开预览浏览器卡住」。所以先按第一页的比例占好位，
 * 滚到跟前才画那一页。
 *
 * ⚠ 占位比例取**第一页**：逐页问一次尺寸要多花 N 个跨 worker 往返，而绝大多数
 * 文档整本同一个开本。比例猜偏的代价只是那一页画出来之后位置跳一下。
 */
import { nextTick, onUnmounted, ref, shallowRef, watch } from 'vue'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import type { RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

import { DtSpinner } from '@dt/ui'

// ⚠ worker 地址必须自己指：不指的话 pdf.js 会去猜一个同目录的地址，
// 而打包之后那个地址不存在——表现是每一份 PDF 都停在「加载中」，控制台里
// 只有一条取不到脚本的 404
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const props = defineProps<{ blob: Blob }>()

/** 画布分辨率的倍率上限。⚠ 不跟满屏幕的 dpr：3 倍屏上一页 A4 就是 3500 px 宽，
 * 一份手册翻十页就把显存吃光，而肉眼分不出 2 倍与 3 倍 */
const MAX_PIXEL_RATIO = 2
/** 提前多远开始画。留一屏，滚动时才不会看见空白格 */
const PRERENDER_MARGIN = '400px'
/** 画布的目标宽度取不到时的兜底（容器还没量出来那一帧）。 */
const FALLBACK_WIDTH = 900

const host = ref<HTMLElement | null>(null)
const pageNumbers = ref<number[]>([])
/** 占位用的宽高比，`宽 / 高`。 */
const ratio = ref(1)
const isLoading = ref(true)
const failure = ref('')

const opened = shallowRef<PDFDocumentProxy | null>(null)
// ⚠ 放手上的是**加载任务**而不是文档：只有它身上有 `destroy()`，而那一下同时
// 停掉后台那个 worker。光丢掉文档引用的话 worker 还在，翻几份 PDF 就攒下几个
let task: PDFDocumentLoadingTask | null = null
const drawn = new Set<number>()
const running: RenderTask[] = []
let watcher: IntersectionObserver | null = null
let isAlive = true

/** 放掉文档、观察器与在画的那几笔。⚠ 少一样都会在关掉弹窗之后接着画。 */
function release(): void {
  watcher?.disconnect()
  watcher = null
  for (const one of running.splice(0)) one.cancel()
  void task?.destroy()
  task = null
  opened.value = null
  drawn.clear()
}

async function load(blob: Blob): Promise<void> {
  release()
  isLoading.value = true
  failure.value = ''
  pageNumbers.value = []
  try {
    const opening = pdfjs.getDocument({ data: await blob.arrayBuffer() })
    task = opening
    const made = await opening.promise
    if (!isAlive) {
      void opening.destroy()
      return
    }
    opened.value = made
    await measure(made)
  } catch {
    // ⚠ 不把 pdf.js 那句原文摆出去：它是英文的内部消息（「Invalid PDF
    // structure」），而用户能做的事只有一件——下载下来用别的软件打开
    failure.value = '这份 PDF 画不出来，可以下载原件后用别的软件打开。'
  } finally {
    if (isAlive) isLoading.value = false
  }
}

/** 量第一页定占位比例，并把页码摆出来。 */
async function measure(made: PDFDocumentProxy): Promise<void> {
  const first = await made.getPage(1)
  const size = first.getViewport({ scale: 1 })
  if (!isAlive) return
  ratio.value = size.width / size.height
  pageNumbers.value = Array.from(
    { length: made.numPages },
    (_unused, at) => at + 1,
  )
  await observePages()
}

/**
 * 等页占位真的渲染出来再挂观察器。
 * ⚠ `nextTick` 不能省：页码是这一帧刚写进 ref 的，此刻 DOM 里还一个占位盒都
 * 没有，当场 `querySelectorAll` 拿到的是空表——表现是滚到哪儿都不画。
 */
async function observePages(): Promise<void> {
  await nextTick()
  if (!isAlive || host.value === null) return
  const made = new IntersectionObserver(onVisible, {
    root: host.value,
    rootMargin: PRERENDER_MARGIN,
  })
  for (const box of Array.from(host.value.querySelectorAll('[data-page]'))) {
    made.observe(box)
  }
  watcher = made
}

function onVisible(entries: readonly IntersectionObserverEntry[]): void {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue
    void draw(entry.target)
  }
}

/**
 * 把一页画进它自己的 canvas。
 * @param box 这一页的占位盒
 */
async function draw(box: Element): Promise<void> {
  const made = opened.value
  const at = Number(box.getAttribute('data-page'))
  const canvas = box.querySelector('canvas')
  if (made === null || !Number.isFinite(at) || canvas === null) return
  // ⚠ 先记账再 await：同一页可以在一帧里被观察器报两次（滚动 + 尺寸变化），
  // 记账放在 await 之后的话两笔会一起开画，画出来的是叠影
  if (drawn.has(at)) return
  drawn.add(at)
  const page = await made.getPage(at)
  if (!isAlive) return
  const scale = scaleFor(page.getViewport({ scale: 1 }).width)
  const viewport = page.getViewport({ scale })
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  // ⚠ 交 `canvas` 而不是它的 2D 上下文：v6 起上下文那一路只是向后兼容的入口，
  // 而它要求 `canvas` 显式为 null，两个都给会当场拒
  const drawing = page.render({ canvas, viewport })
  running.push(drawing)
  await drawing.promise.catch(() => undefined)
}

/**
 * 按容器宽度算画布倍率。
 * ⚠ 只在画那一页的时候算一次，之后靠 CSS 把画布缩到容器宽：改一次窗口大小
 * 就把全部已画的页重画一遍，代价远大于那点清晰度。
 * @param baseWidth 这一页在 1 倍下的宽度
 */
function scaleFor(baseWidth: number): number {
  const width = host.value?.clientWidth ?? FALLBACK_WIDTH
  const ratioOfScreen = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO)
  return ((width > 0 ? width : FALLBACK_WIDTH) / baseWidth) * ratioOfScreen
}

watch(() => props.blob, load, { immediate: true })

onUnmounted(() => {
  isAlive = false
  release()
})
</script>

<template>
  <div ref="host" class="doc-pdf">
    <DtSpinner v-if="isLoading" />
    <p v-else-if="failure !== ''" class="doc-pdf__failed">{{ failure }}</p>
    <div
      v-for="at in pageNumbers"
      :key="at"
      class="doc-pdf__page"
      :data-page="at"
      :style="{ aspectRatio: String(ratio) }"
    >
      <canvas />
    </div>
  </div>
</template>

<style scoped lang="scss">
.doc-pdf {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 16px;
  overflow: auto;
  background: var(--surface-sunken);

  &__failed {
    margin: auto;
    color: var(--text-secondary);
    font-size: 0.8125rem;
  }

  &__page {
    width: 100%;
    // ⚠ 别让它比原尺寸还宽：小开本的图纸拉满容器之后每一根线都是糊的
    max-width: 60rem;
    flex: none;
    background: var(--fx-const-paper);
    box-shadow: var(--fx-shadow-menu);
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
}
</style>
