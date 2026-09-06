/**
 * @fileoverview 三个 SVG 图元件的宽度归摆放它的那一区管，组件自己不焊上限。
 *
 * ⚠ 这是「配了不生效」的系统性根因：上限焊在组件的 style 块里时，区把某张图
 * 指定成规格 §3.2 的 44rem 主体图**推不动它**，会被静默截回组件写死的那个数，
 * 而挂载测试量不出宽度（happy-dom 不排版），只有读源码钉得住。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ⚠ vitest 的 cwd 就是 web/，不要再往上退一层
const DIR = join(
  process.cwd(),
  'app',
  'src',
  'pages',
  'Modeling',
  'Canvas',
  'components',
)

const CHARTS = ['HistogramChart', 'ScatterPlot', 'TimelineBand']

/** 可被区覆盖的那个上限；三个元件共用一个名字，区设一次就管住整片。 */
const KNOB = '--dt-ml-chart-max'

const COMMENTS = [/\/\*[\s\S]*?\*\//g, /(^|[^:])\/\/[^\n]*/g]

/** 剥掉注释再扫：注释里写着上限的来历，那是在讲它不是在设它。 */
function styleOf(name: string): string {
  const source = readFileSync(join(DIR, `${name}.vue`), 'utf8')
  const block = /<style scoped lang="scss">([\s\S]*?)<\/style>/.exec(source)
  expect(block?.[1], `${name} 得有 scoped SCSS 块`).toBeTruthy()
  return COMMENTS.reduce(
    (out, pattern) =>
      out.replace(pattern, (_hit: string, head: unknown) =>
        typeof head === 'string' ? head : ' ',
      ),
    block?.[1] ?? '',
  )
}

describe('图元件的宽度不焊死', () => {
  it.each(CHARTS)('%s 的每条 max-width 都走可覆盖的那个变量', (name) => {
    const declarations = [...styleOf(name).matchAll(/max-width\s*:\s*([^;]+)/g)]

    expect(declarations.length).toBeGreaterThan(0)
    for (const [, value] of declarations) {
      expect(value?.trim()).toMatch(new RegExp(`^var\\(\\s*${KNOB}\\s*,`))
    }
  })

  it.each(CHARTS)('%s 的 svg 只写 width，宽度跟着容器走', (name) => {
    const svg = /\bsvg\s*\{([^}]*)\}/.exec(styleOf(name))

    expect(svg?.[1]).toContain('width: 100%')
    expect(svg?.[1]).not.toContain('max-width')
  })
})
