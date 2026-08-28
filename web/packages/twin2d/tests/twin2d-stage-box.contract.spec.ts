/**
 * @fileoverview 舞台那只宿主盒必须自己声明宽高：`Twin2dStage` 量它算缩放，量到 0 就
 * 整块 `visibility: hidden`，而它的孩子全是绝对定位，不声明尺寸时内容高恒为 0。
 *
 * ⚠ 守的是一个零提示的洞：模块整块空白、连空态那行字都不出现，控制台一声不吭，
 * 而编辑画布另有一份显式 100% 的宿主，照画不误——「编辑器里有、大屏上没有」。
 * ⚠ 量的取法也守在这里：`getBoundingClientRect` 返回被祖先 `transform: scale` 缩过的
 * **视觉**盒，而大屏编辑器正是整块缩放设计坐标系的——用它贴合的表现是「编辑器里这块图
 * 只占了格子的一角」，运行态与预览却一切正常。
 * ⚠ 这两条都只能从文件上守：happy-dom 没有排版引擎，两种取法与 `getBoundingClientRect`
 * 一样恒回 0，挂载测试量出来的盒永远是 0×0，真出这个 bug 时全部单测照样绿。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ⚠ vitest 的 cwd 就是 web/，不要再往上退一层
const RENDER = join(process.cwd(), 'packages', 'twin2d', 'src', 'render')
const SCSS = join(RENDER, 'twin2d.scss')
const STAGE = join(RENDER, 'Twin2dStage.vue')

/** 舞台宿主那条规则的选择器。 */
const HOST_SELECTOR = '.t2-stage'

/**
 * 取一条规则的声明块。
 * @param css 整份样式
 * @param selector 选择器，必须自成一条规则
 */
function ruleBody(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`)
  if (at < 0) throw new Error(`${selector} 这条规则没了`)
  const open = css.indexOf('{', at)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

describe('舞台宿主盒', () => {
  it('宽高两条都写在规则里，不靠内容把盒撑开', () => {
    const body = ruleBody(readFileSync(SCSS, 'utf8'), HOST_SELECTOR)

    expect(body).toMatch(/(^|\s)width:\s*\S+/)
    expect(body).toMatch(/(^|\s)height:\s*\S+/)
  })

  it('孩子全是绝对定位，所以撑不起这只盒', () => {
    const css = readFileSync(SCSS, 'utf8')

    // 这三条是舞台的直接孩子；只要它们还是绝对定位，上面那条就一条都省不得
    for (const selector of [
      '.t2-stage__viewport',
      '.t2-stage__empty',
      '.t2-sprite',
    ]) {
      expect(ruleBody(css, selector)).toContain('position: absolute')
    }
  })
})

describe('量宿主的取法', () => {
  it('量的是排版盒，不碰 getBoundingClientRect', () => {
    const source = readFileSync(STAGE, 'utf8')
    // 注释里提得起它，代码里一次都不许调
    const calls = source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*'))
      .filter((line) => line.includes('getBoundingClientRect'))

    expect(calls).toEqual([])
    expect(source).toContain('offsetWidth')
    expect(source).toContain('offsetHeight')
  })
})
