/**
 * @fileoverview PDF 原件的画法：先占位、滚到跟前才画那一页。
 *
 * ⚠ 这几条盯的是「点开预览浏览器卡住」：一份两百页的手册要是一上来就把每一页
 * 都画出来，会当场吃掉几百 MB 显存。判据只能是 canvas 的真实尺寸——没画的那几页
 * 是默认的 300×150，而占位盒的背景就是白纸色，光看画面分不出「这一页是空白」
 * 还是「这一页没画」。
 *
 * ⚠ 还有一条盯的是卸载：不 destroy 那个加载任务的话，后台那个 worker 会一直挂着，
 * 翻几份 PDF 就攒下几个。
 */
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import DocumentPreviewPdf from '@/pages/Knowledge/components/DocumentPreviewPdf.vue'

const pdfjs = vi.hoisted(() => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn(),
}))
vi.mock('pdfjs-dist', () => pdfjs)
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({
  default: 'blob:fake/worker',
}))

interface FakeObserver {
  observe: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  fire: (targets: readonly Element[]) => void
}

const observers: FakeObserver[] = []
const originalObserver = globalThis.IntersectionObserver

const destroy = vi.fn()
const renderCalls: { canvas: HTMLCanvasElement }[] = []

/** 一页：1 倍下 600×850，画的时候按调用方给的 scale 放大。 */
function fakePage() {
  return {
    getViewport: ({ scale }: { scale: number }) => ({
      width: 600 * scale,
      height: 850 * scale,
    }),
    render: (params: { canvas: HTMLCanvasElement }) => {
      renderCalls.push(params)
      return { promise: Promise.resolve(), cancel: vi.fn() }
    },
  }
}

/** happy-dom 自带的 observer 不会真的相交，装一个能手动触发的。 */
function installObserver(): void {
  class Fake {
    observe = vi.fn()
    disconnect = vi.fn()
    constructor(private readonly callback: IntersectionObserverCallback) {
      observers.push({
        observe: this.observe,
        disconnect: this.disconnect,
        fire: (targets) => {
          this.callback(
            targets.map(
              (target) =>
                ({ isIntersecting: true, target }) as IntersectionObserverEntry,
            ),
            this as unknown as IntersectionObserver,
          )
        },
      })
    }
  }
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    value: Fake,
    configurable: true,
    writable: true,
  })
}

function latest(): FakeObserver {
  const found = observers.at(-1)
  if (found === undefined) throw new Error('没有创建 observer')
  return found
}

beforeEach(() => {
  observers.length = 0
  renderCalls.length = 0
  destroy.mockReset()
  installObserver()
  pdfjs.getDocument.mockReset()
  pdfjs.getDocument.mockReturnValue({
    promise: Promise.resolve({
      numPages: 3,
      getPage: () => Promise.resolve(fakePage()),
    }),
    destroy,
  })
})

afterEach(() => {
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    value: originalObserver,
    configurable: true,
    writable: true,
  })
})

async function render(): Promise<VueWrapper> {
  const wrapper = mount(DocumentPreviewPdf, {
    props: { blob: new Blob(['%PDF-1.4']) },
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper
}

/** 页占位盒上那几张 canvas 的真实像素尺寸。 */
function canvasSizes(wrapper: VueWrapper): string[] {
  return wrapper
    .findAll('canvas')
    .map((one) => `${one.element.width}x${one.element.height}`)
}

describe('PDF 原件的画法', () => {
  it('按页数摆出占位盒，并把 worker 地址指死', async () => {
    const wrapper = await render()

    expect(wrapper.findAll('[data-page]')).toHaveLength(3)
    // ⚠ 不指的话 pdf.js 会去猜一个同目录的地址，打包之后那个地址不存在
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe('blob:fake/worker')
  })

  it('⚠ 一上来一页都不画，滚到跟前那一页才画', async () => {
    const wrapper = await render()
    expect(renderCalls).toHaveLength(0)

    const boxes = wrapper.findAll('[data-page]').map((one) => one.element)
    latest().fire([boxes[1] as Element])
    await flushPromises()

    // 只有被报相交的那一页拿到了真实尺寸，其余两页还是 canvas 的默认值。
    // ⚠ 900×1275 是 1.5 倍：happy-dom 把容器宽量成 0，于是走了兜底宽度
    // 900——真浏览器里这个数跟着容器走，这里验的是「画了没画」不是画多大
    expect(canvasSizes(wrapper)).toEqual(['300x150', '900x1275', '300x150'])
  })

  it('⚠ 同一页被报两次也只画一次，否则画出来的是叠影', async () => {
    const wrapper = await render()
    const box = wrapper.find('[data-page]').element

    latest().fire([box])
    latest().fire([box])
    await flushPromises()

    expect(renderCalls).toHaveLength(1)
  })

  it('⚠ 卸载时把加载任务 destroy 掉，别让后台那个 worker 一直挂着', async () => {
    const wrapper = await render()

    wrapper.unmount()
    await flushPromises()

    expect(destroy).toHaveBeenCalled()
    expect(latest().disconnect).toHaveBeenCalled()
  })

  it('打不开时说一句人话，而不是停在加载态', async () => {
    pdfjs.getDocument.mockReturnValue({
      promise: Promise.reject(new Error('Invalid PDF structure')),
      destroy,
    })

    const wrapper = await render()

    // ⚠ 不摆 pdf.js 那句英文原文：用户能做的只有一件事——下载下来用别的软件打开
    expect(wrapper.text()).toContain('这份 PDF 画不出来')
    expect(wrapper.find('.dt-spinner').exists()).toBe(false)
  })
})
