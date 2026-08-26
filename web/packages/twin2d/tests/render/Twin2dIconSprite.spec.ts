/**
 * @fileoverview sprite 宿主：11 枚 symbol 挂进 DOM，且 `v-html` 那一处渲染出来的
 * 就是 `icons.svg` 的原文、没有任何插值口子。
 *
 * ⚠ symbol 少一枚不会报错，只是那一档图标空白；`v-html` 一旦被 prop 或插槽渗进去，
 * 这个组件立刻从「内联静态资源」变成 XSS 落点，而 lint 的放行注释还挂在原地。
 */
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { TWIN_2D_SPRITE_IDS } from '../../src/kinds'
import Twin2dIconSprite from '../../src/render/Twin2dIconSprite.vue'

/**
 * sprite 原文与宿主源码都从磁盘现读，不经组件自己那条导入。
 * ⚠ 从 `process.cwd()`（web workspace 根）拼路径：happy-dom 那一趟里
 * `import.meta.url` 不是 `file:` 协议，`fileURLToPath` 会当场抛。
 */
const RENDER_DIR = join(process.cwd(), 'packages', 'twin2d', 'src', 'render')
const SPRITE_SVG = readFileSync(join(RENDER_DIR, 'icons.svg'), 'utf8')
const HOST_SOURCE = readFileSync(
  join(RENDER_DIR, 'Twin2dIconSprite.vue'),
  'utf8',
)

/**
 * 把 sprite 原文另行解析一遍，作为「应有的 DOM」参照。
 * ⚠ 只取 `<svg>` 这一棵：文件开头的 XML 声明与注释在整文档解析里落在 body 之外，
 * 与内联进 div 时的落点不同，拿来对比会假红。
 */
function expectedSvgHtml(): string {
  const parsed = new DOMParser().parseFromString(SPRITE_SVG, 'text/html')
  return parsed.body.innerHTML.trim()
}

/**
 * 宿主那个容器 div。
 * ⚠ 不能直接用 `wrapper.element`：模板里那行 eslint 放行注释在 dev 构建下会留成
 * 注释节点，组件因此是多根的，`wrapper.element` 拿到的是包着注释的那一层。
 */
function host(wrapper: ReturnType<typeof mount>): Element {
  return wrapper.get('.twin2d-icon-sprite').element
}

describe('挂载后的 symbol', () => {
  it.each(TWIN_2D_SPRITE_IDS)('%s 在 DOM 里', (id) => {
    const wrapper = mount(Twin2dIconSprite)

    expect(host(wrapper).querySelector(`#${id}`)).not.toBeNull()
  })

  it('宿主自己零尺寸不参与布局，且对辅助技术隐藏', () => {
    const wrapper = mount(Twin2dIconSprite)

    expect(host(wrapper).getAttribute('aria-hidden')).toBe('true')
  })
})

describe('v-html 那一处', () => {
  it('渲染出来的就是 icons.svg 的原文', () => {
    const wrapper = mount(Twin2dIconSprite)

    const svg = host(wrapper).querySelector('svg')
    expect(svg?.outerHTML).toBe(expectedSvgHtml())
  })

  // 外部内容能进来的两条路：透传属性与插槽。两条都堵死，v-html 才谈得上安全
  it('透传属性与插槽内容一个字都进不了 v-html', () => {
    const plain = mount(Twin2dIconSprite)
    const probed = mount(Twin2dIconSprite, {
      attrs: { 'data-probe': '<img src=x onerror=alert(1)>' },
      slots: { default: '<b class="leak">leak</b>' },
    })

    expect(host(probed).innerHTML).toBe(host(plain).innerHTML)
    expect(host(probed).querySelector('.leak')).toBeNull()
  })

  it('宿主源码里 v-html 只有一处，且绑的是模块常量而非 prop', () => {
    expect(HOST_SOURCE.match(/v-html=/g)).toHaveLength(1)
    expect(HOST_SOURCE).toContain('v-html="iconSprite"')
    expect(HOST_SOURCE).not.toContain('defineProps')
  })
})
