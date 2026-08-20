/**
 * @fileoverview 契约：二次确认必须盖在把它问出来的那个弹窗之上。
 *
 * ⚠ 这条守的是一个纯 CSS、全绿通过的洞：两个弹窗都 `Teleport to="body"`，
 * z-index 相同的时候谁在上只由 body 里的先后决定。确认框的宿主挂在 App.vue，
 * 比任何页面弹窗都早，所以同层就一定被提问者整个盖住——用户点了「重新发布」，
 * 看到的是弹窗纹丝不动，而流程其实已经停在一个看不见的确认框上。
 * typecheck、eslint、单测一律放行，只有人眼盯着那一处才看得见。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import DtConfirmHost from '../../src/components/DtConfirmHost/DtConfirmHost.vue'
import DtModal from '../../src/components/DtModal/DtModal.vue'
import { useConfirm } from '../../src/composables/useConfirm'

enableAutoUnmount(afterEach)

afterEach(() => {
  useConfirm().resolve(false)
})

// ⚠ vitest 的 cwd 就是 web/，不要再往上退一层
const TOKENS_SCSS = join(
  process.cwd(),
  'packages',
  'tokens',
  'src',
  'tokens.scss',
)

/** 取层级标尺上的一档。取不到给 NaN，让断言红在这里而不是静默通过。 */
function layer(name: string): number {
  const found = new RegExp(`--z-${name}:\\s*(\\d+)`).exec(
    readFileSync(TOKENS_SCSS, 'utf8'),
  )
  return Number(found?.[1] ?? Number.NaN)
}

describe('层级标尺', () => {
  it('确认框在弹窗之上、消息之下', () => {
    // 消息要压过确认框：「删除失败」得在人还盯着那个框的时候就看得见
    expect(layer('confirm')).toBeGreaterThan(layer('modal'))
    expect(layer('confirm')).toBeLessThan(layer('toast'))
  })
})

describe('确认框叠在提问的弹窗上', () => {
  it('宿主先挂、页面弹窗后挂——同层的话确认框必被盖住', async () => {
    mount(DtConfirmHost)
    mount(DtModal, { props: { modelValue: true, title: '公开分享' } })
    void useConfirm().ask({ message: '重新发布会换一条链接' })
    await Promise.resolve()

    const roots = [...document.querySelectorAll('.dt-modal')]
    const confirmAt = roots.findIndex((node) =>
      node.textContent?.includes('重新发布会换一条链接'),
    )
    const askerAt = roots.findIndex((node) =>
      node.textContent?.includes('公开分享'),
    )
    expect(confirmAt).toBeGreaterThanOrEqual(0)
    expect(confirmAt).toBeLessThan(askerAt)
  })

  it('所以确认框走 confirm 层，页面弹窗走默认的 modal 层', async () => {
    mount(DtConfirmHost)
    mount(DtModal, { props: { modelValue: true, title: '公开分享' } })
    void useConfirm().ask({ message: '重新发布会换一条链接' })
    await Promise.resolve()

    expect(document.querySelector('.dt-modal--confirm')?.textContent).toContain(
      '重新发布会换一条链接',
    )
    expect(document.querySelector('.dt-modal--modal')?.textContent).toContain(
      '公开分享',
    )
  })
})
