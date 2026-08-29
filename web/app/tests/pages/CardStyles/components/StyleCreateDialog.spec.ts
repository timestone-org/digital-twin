/**
 * @fileoverview 新建样式那一步的契约：归属定了就不能改，所以这一步得问准。
 *
 * ⚠ 弹窗 teleport 到 body，断言一律查 `document.body`——查 wrapper 的话它永远是
 * 一对空的 teleport 注释，而「找不到」看着像组件没渲染。
 */
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import StyleCreateDialog from '@/pages/CardStyles/components/StyleCreateDialog.vue'

// ⚠ 必须自动卸载：宿主 teleport 到 body，上一条不卸载就直接清 body 时，
// 下一次更新会撞上已被摘掉的 teleport 容器
enableAutoUnmount(afterEach)

const MODULES = [
  { value: 'info-card', label: '信息卡片' },
  { value: 'gauge-card', label: '仪表卡片' },
]

async function mountDialog(): Promise<ReturnType<typeof mount>> {
  const wrapper = mount(StyleCreateDialog, {
    props: { modelValue: true, moduleOptions: MODULES },
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper
}

/** 按文案找按钮。弹窗在 body 上，只能从那里找。 */
function buttonByText(text: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll('button')].find(
    (item) => (item.textContent ?? '').trim() === text,
  )
  if (!(found instanceof HTMLButtonElement)) {
    throw new Error(`没有文案为「${text}」的按钮`)
  }
  return found
}

function nameInput(): HTMLInputElement {
  const found = document.body.querySelector('input[type="text"]')
  if (!(found instanceof HTMLInputElement)) throw new Error('没有名称输入框')
  return found
}

async function typeName(value: string): Promise<void> {
  const input = nameInput()
  input.value = value
  input.dispatchEvent(new Event('input'))
  await flushPromises()
}

describe('新建样式', () => {
  it('通用外壳与每个模块各一档', async () => {
    await mountDialog()
    const text = document.body.textContent ?? ''

    expect(text).toContain('通用外壳样式')
    expect(text).toContain('信息卡片')
    expect(text).toContain('仪表卡片')
  })

  it('名字空着时建不出来', async () => {
    await mountDialog()

    expect(buttonByText('新建').disabled).toBe(true)
  })

  it('取了名就能建；缺省是通用外壳，模块类型给 null', async () => {
    const page = await mountDialog()
    await typeName('蓝调科技卡')
    buttonByText('新建').click()
    await flushPromises()

    expect(page.emitted('create')?.[0]).toEqual([null, '蓝调科技卡'])
    expect(page.emitted('update:modelValue')?.[0]).toEqual([false])
  })

  it('首尾空格去掉再上抛，免得存出一个看不见的名字', async () => {
    const page = await mountDialog()
    await typeName('  蓝调  ')
    buttonByText('新建').click()
    await flushPromises()

    expect(page.emitted('create')?.[0]).toEqual([null, '蓝调'])
  })

  it('取消不上抛，只关窗', async () => {
    const page = await mountDialog()
    await typeName('蓝调')
    buttonByText('取消').click()
    await flushPromises()

    expect(page.emitted('create')).toBeUndefined()
    expect(page.emitted('update:modelValue')?.[0]).toEqual([false])
  })

  // ⚠ 留着上一次的选择，用户会以为自己已经选过了
  it('重新打开时名字清回原样', async () => {
    const page = await mountDialog()
    await typeName('蓝调')
    await page.setProps({ modelValue: false })
    await page.setProps({ modelValue: true })
    await flushPromises()

    expect(nameInput().value).toBe('')
  })
})
