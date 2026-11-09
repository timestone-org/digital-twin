/**
 * @fileoverview 契约：有弹窗开着时消息改挂到右上角，不盖弹窗右下角的提交键。
 * ⚠ 消息层刻意压在确认框之上（见 DtModal.contract.spec.ts），所以挂在右下角时
 * 正好盖住高弹窗底栏里的「保存」；happy-dom 不排版，故编译样式检查声明。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compileString } from 'sass-embedded'
import { describe, expect, it } from 'vitest'

const COMPONENT = join(
  process.cwd(),
  'packages',
  'ui',
  'src',
  'components',
  'DtToastHost',
  'DtToastHost.vue',
)
const SOURCE = readFileSync(COMPONENT, 'utf8')
const STYLE = /<style scoped lang="scss">([\s\S]*?)<\/style>/.exec(SOURCE)?.[1]
if (!STYLE) throw new Error('DtToastHost 的 scoped SCSS 块没了')
const CSS = compileString(STYLE, {
  url: pathToFileURL(COMPONENT),
  loadPaths: [join(process.cwd(), 'packages', 'ui', 'src', 'styles')],
}).css

/** 页签被 KeepAlive 收起时弹窗只是 v-show 藏起，节点还在 body 里。 */
const OPEN_MODAL_SELECTOR =
  'body:has(.dt-modal:not([style*="display: none"])) .dt-toasts'

/** 取一条选择器的声明块；没有这条规则时返回空串。 */
function ruleBody(selector: string): string {
  const start = CSS.indexOf(`${selector} {`)
  if (start < 0) return ''
  const open = CSS.indexOf('{', start)
  return CSS.slice(open + 1, CSS.indexOf('}', open))
}

describe('消息的位置', () => {
  it('没有弹窗时挂在右下角', () => {
    expect(ruleBody('.dt-toasts')).toMatch(/bottom:\s*20px/)
  })

  it('有弹窗开着时改挂右上角', () => {
    const body = ruleBody(OPEN_MODAL_SELECTOR)
    expect(body).toMatch(/top:\s*20px/)
    expect(body).toMatch(/bottom:\s*auto/)
  })

  it('被收起的页签里挂着的弹窗（v-show 藏起）不算开着', () => {
    expect(CSS).not.toContain('body:has(.dt-modal) .dt-toasts')
    expect(ruleBody(OPEN_MODAL_SELECTOR)).not.toBe('')
  })
})
