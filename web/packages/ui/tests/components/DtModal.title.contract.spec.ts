/**
 * @fileoverview 契约：弹窗标题最多两行，全名放在悬浮提示里。
 * ⚠ 素材名、文件名这类长串放进标题会排成三四行，把正文整段往下顶；
 * happy-dom 不排版，故截断的那半编译样式检查声明。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mount } from '@vue/test-utils'
import { compileString } from 'sass-embedded'
import { describe, expect, it } from 'vitest'

import DtModal from '../../src/components/DtModal/DtModal.vue'

const COMPONENT = join(
  process.cwd(),
  'packages',
  'ui',
  'src',
  'components',
  'DtModal',
  'DtModal.vue',
)
const SOURCE = readFileSync(COMPONENT, 'utf8')
const STYLE = /<style scoped lang="scss">([\s\S]*?)<\/style>/.exec(SOURCE)?.[1]
if (!STYLE) throw new Error('DtModal 的 scoped SCSS 块没了')
const CSS = compileString(STYLE, { url: pathToFileURL(COMPONENT) }).css

/** 取一条选择器的声明块；没有这条规则时返回空串。 */
function ruleBody(selector: string): string {
  const start = CSS.indexOf(`${selector} {`)
  if (start < 0) return ''
  const open = CSS.indexOf('{', start)
  return CSS.slice(open + 1, CSS.indexOf('}', open))
}

describe('DtModal 标题', () => {
  it('超过两行截成省略号', () => {
    const body = ruleBody('.dt-modal__title')
    expect(body).toMatch(/-webkit-line-clamp:\s*2/)
    expect(body).toMatch(/overflow:\s*hidden/)
  })

  it('全名挂在标题的悬浮提示上', () => {
    const name = '一号车间-喷涂线-超长素材名称用于检验标题截断.glb'
    const wrapper = mount(DtModal, {
      props: { modelValue: true, title: name },
      attachTo: document.body,
    })
    const title = document.body.querySelector('.dt-modal__title')
    expect(title?.getAttribute('title')).toBe(name)
    wrapper.unmount()
  })
})
