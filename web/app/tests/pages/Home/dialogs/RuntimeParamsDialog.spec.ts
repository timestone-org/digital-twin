/**
 * @fileoverview 契约：运行参数弹窗自己取数、四项旋钮与后端目录逐字对齐、
 * 每项显示 env 名，且「恢复默认」的文案说的是删覆盖值重新跟随环境变量。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { useConfirm } from '@dt/ui'
import type { RuntimeParamItem } from '@dt/contracts'

import * as runtimeApi from '@/api/runtimeParams'
import RuntimeParamsDialog from '@/pages/Home/components/RuntimeParamsDialog.vue'

function item(
  key: string,
  value: number,
  overridden = false,
): RuntimeParamItem {
  return {
    section: 'dashboard',
    key,
    envName: `PLATFORM_${key.toUpperCase()}`,
    label: key,
    value,
    defaultValue: value,
    overridden,
    updatedBy: null,
    updatedAt: null,
    previousValue: null,
  }
}

const ROWS: RuntimeParamItem[] = [
  item('publish_window_ms', 1000),
  item('publish_max_items', 200),
  item('publish_stale_after_ms', 15000, true),
  item('publish_reconcile_interval_s', 5),
]

function mountDialog(open: boolean) {
  return mount(RuntimeParamsDialog, {
    props: { open },
    global: { stubs: { Teleport: true } },
  })
}

async function clickText(
  wrapper: ReturnType<typeof mountDialog>,
  label: string,
): Promise<void> {
  const hit = wrapper
    .findAll('button')
    .find((button) => button.text().includes(label))
  expect(hit, `没有文案含「${label}」的按钮`).toBeDefined()
  await hit?.trigger('click')
}

beforeEach(() => {
  vi.spyOn(runtimeApi, 'listRuntimeParams').mockResolvedValue(ROWS)
  vi.spyOn(runtimeApi, 'saveRuntimeParams').mockResolvedValue(ROWS)
  vi.spyOn(runtimeApi, 'resetRuntimeParams').mockResolvedValue(ROWS)
})

afterEach(() => {
  vi.restoreAllMocks()
  useConfirm().resolve(false)
})

describe('取数', () => {
  it('关着的时候不取数', () => {
    mountDialog(false)

    expect(runtimeApi.listRuntimeParams).not.toHaveBeenCalled()
  })

  it('打开时按 dashboard 这一组取一次', async () => {
    const wrapper = mountDialog(false)

    await wrapper.setProps({ open: true })
    await flushPromises()

    expect(runtimeApi.listRuntimeParams).toHaveBeenCalledWith('dashboard')
  })

  it('四项旋钮都画出来，且各自带上 env 名供对照 .env', async () => {
    const wrapper = mountDialog(true)
    await flushPromises()

    expect(wrapper.text()).toContain('推送合并窗口')
    expect(wrapper.text()).toContain('单帧最多点位数')
    expect(wrapper.text()).toContain('判陈旧的时长')
    expect(wrapper.text()).toContain('订阅对账间隔')
    expect(wrapper.text()).toContain('PLATFORM_PUBLISH_WINDOW_MS')
  })

  it('被覆盖过的项标出来，没覆盖过的写明跟随环境变量', async () => {
    const wrapper = mountDialog(true)
    await flushPromises()

    expect(wrapper.text()).toContain('已覆盖')
    expect(wrapper.text()).toContain('跟随环境变量')
  })

  it('后端没回的键不画，避免提交一个后端不认的项', async () => {
    vi.spyOn(runtimeApi, 'listRuntimeParams').mockResolvedValue([
      item('publish_window_ms', 1000),
    ])
    const wrapper = mountDialog(true)
    await flushPromises()

    expect(wrapper.text()).toContain('推送合并窗口')
    expect(wrapper.text()).not.toContain('单帧最多点位数')
  })

  it('取数失败时把原因摆出来', async () => {
    vi.spyOn(runtimeApi, 'listRuntimeParams').mockRejectedValue(
      new Error('网关炸了'),
    )
    const wrapper = mountDialog(true)
    await flushPromises()

    expect(wrapper.text()).toContain('网关炸了')
  })
})

describe('保存与恢复默认', () => {
  it('保存把当前四项的取值整组提交上去', async () => {
    const wrapper = mountDialog(true)
    await flushPromises()

    await clickText(wrapper, '保存')
    await flushPromises()

    expect(runtimeApi.saveRuntimeParams).toHaveBeenCalledWith('dashboard', {
      publish_window_ms: 1000,
      publish_max_items: 200,
      publish_stale_after_ms: 15000,
      publish_reconcile_interval_s: 5,
    })
  })

  it('改过的取值跟着提交上去', async () => {
    const wrapper = mountDialog(true)
    await flushPromises()
    const input = wrapper.findAll('input')[0]
    await input?.setValue('2500')
    await input?.trigger('change')

    await clickText(wrapper, '保存')
    await flushPromises()

    expect(runtimeApi.saveRuntimeParams).toHaveBeenCalledWith(
      'dashboard',
      expect.objectContaining({ publish_window_ms: 2500 }),
    )
  })

  it('界面上说的是删覆盖值重新跟随环境变量，不是写回硬编码默认值', async () => {
    const wrapper = mountDialog(true)
    await flushPromises()

    expect(wrapper.text()).toContain('环境变量是永久默认值')
    expect(wrapper.text()).toContain('重新跟随')
  })

  it('恢复默认先问一遍，答不恢复就不发请求', async () => {
    const wrapper = mountDialog(true)
    await flushPromises()

    await clickText(wrapper, '恢复默认')
    useConfirm().resolve(false)
    await flushPromises()

    expect(runtimeApi.resetRuntimeParams).not.toHaveBeenCalled()
  })

  it('答应之后才删这一组的覆盖值', async () => {
    const wrapper = mountDialog(true)
    await flushPromises()

    await clickText(wrapper, '恢复默认')
    useConfirm().resolve(true)
    await flushPromises()

    expect(runtimeApi.resetRuntimeParams).toHaveBeenCalledWith('dashboard')
  })
})

describe('弹窗自带的关闭路径', () => {
  it('点弹窗右上角的关闭键把 update:open(false) 转出去', async () => {
    const wrapper = mountDialog(true)

    await wrapper.find('[aria-label="关闭"]').trigger('click')

    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })
})
