/**
 * @fileoverview 签发弹窗与明文回执弹窗。
 *
 * ⚠ 这里守的是密钥这套东西唯一不可挽回的一步：明文只回一次。它要么当场被
 * 完整摆出来、能一键抄走，要么就永远没了——做成一条会自己消失的 toast，
 * 用户就失去了那唯一一次机会。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'

import { DtToastHost, useToast } from '@dt/ui'

import * as apiKeys from '@/api/apiKeys'
import IssueKeyDialog from '@/pages/System/ApiKeys/components/IssueKeyDialog.vue'
import SecretRevealDialog from '@/pages/System/ApiKeys/components/SecretRevealDialog.vue'
import * as clipboard from '@/utils/clipboard'

const SECRET = 'dtk_a1b2c3d4_head_middle_tail'

function listItem(over: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    username: 'svc-third-party',
    email: 'svc@example.com',
    full_name: null,
    avatar_url: null,
    phone: null,
    is_active: true,
    last_login_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    role: { id: 'r1', name: 'viewer', description: null, is_builtin: true },
    direct_permission_count: 0,
    ...over,
  } as never
}

function issuedKey() {
  return {
    api_key: {
      id: 'k1',
      user_id: 'u1',
      name: 'XX系统写点位',
      prefix: 'a1b2c3d4',
      is_active: true,
      expires_at: null,
      last_used_at: null,
      revoked_at: null,
      created_at: '2026-08-14T00:00:00.000Z',
    },
    secret: SECRET,
  } as never
}

enableAutoUnmount(afterEach)

afterEach(() => {
  useToast().clear()
  vi.restoreAllMocks()
})

/** 按可见文案点弹窗里的按钮。DtModal teleport 在 body 上。 */
async function clickByText(text: string): Promise<void> {
  const button = [...document.querySelectorAll('button')].find((node) =>
    node.textContent?.trim().includes(text),
  )
  button?.click()
  await flushPromises()
}

/** 往弹窗里的输入框打字。⚠ DtModal teleport 在 body 上，wrapper.find 找不到。 */
async function typeInInput(placeholder: string, value: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>(
    `input[placeholder="${placeholder}"]`,
  )
  if (input === null)
    throw new Error(`没有 placeholder 为「${placeholder}」的输入框`)
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
}

/** 在第 n 个 DtSelect 里点一个选项。 */
async function pickInSelect(index: number, label: string): Promise<void> {
  const triggers = [...document.querySelectorAll('.dt-select__trigger')]
  ;(triggers[index] as HTMLElement | undefined)?.click()
  await flushPromises()
  const option = [...document.querySelectorAll('.dt-select-menu__item')].find(
    (node) => node.textContent?.trim() === label,
  )
  option?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
}

describe('签发弹窗', () => {
  beforeEach(() => {
    vi.spyOn(apiKeys, 'issueApiKey').mockResolvedValue(issuedKey())
  })

  it('把归属账号的权限摊开说——不让人凭账号名猜这把钥匙能开哪些门', async () => {
    mount(IssueKeyDialog, {
      props: {
        modelValue: true,
        users: [listItem({ direct_permission_count: 2 })],
      },
    })
    await flushPromises()
    await pickInSelect(0, 'svc-third-party（viewer）')
    expect(document.body.textContent).toContain('viewer 权限')
    expect(document.body.textContent).toContain('2 条直权')
  })

  it('没选账号或没填用途就提交，当场拦下且不发请求', async () => {
    mount(IssueKeyDialog, { props: { modelValue: true, users: [listItem()] } })
    await flushPromises()
    await clickByText('签发')
    expect(apiKeys.issueApiKey).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('请选择归属账号并填写用途')
  })

  it('默认一年；选「永不过期」才发 null——它得是主动选的', async () => {
    mount(IssueKeyDialog, {
      props: { modelValue: true, users: [listItem()] },
    })
    await flushPromises()
    await pickInSelect(0, 'svc-third-party（viewer）')
    await typeInInput('例如：XX 系统写点位', 'XX系统写点位')
    await pickInSelect(1, '永不过期')
    await clickByText('签发')
    expect(apiKeys.issueApiKey).toHaveBeenCalledWith({
      user_id: 'u1',
      name: 'XX系统写点位',
      expires_in_days: null,
    })
  })

  it('签发成功后把明文交给上层，并关掉自己', async () => {
    const wrapper = mount(IssueKeyDialog, {
      props: { modelValue: true, users: [listItem()] },
    })
    await flushPromises()
    await pickInSelect(0, 'svc-third-party（viewer）')
    await typeInInput('例如：XX 系统写点位', 'XX系统写点位')
    await clickByText('签发')
    expect(wrapper.emitted('issued')?.[0]).toEqual([
      { name: 'XX系统写点位', secret: SECRET },
    ])
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false])
  })
})

describe('明文回执弹窗', () => {
  it('完整摆出明文，并说清关掉就没了', async () => {
    mount(SecretRevealDialog, {
      props: { issued: { name: 'XX系统写点位', secret: SECRET } },
    })
    await flushPromises()
    expect(document.body.textContent).toContain(SECRET)
    expect(document.body.textContent).toContain('只能吊销后重发')
  })

  it('示例里把密钥直接放进 Bearer——不需要登录、不需要刷新循环', async () => {
    mount(SecretRevealDialog, {
      props: { issued: { name: 'XX系统写点位', secret: SECRET } },
    })
    await flushPromises()
    expect(document.body.textContent).toContain(
      `Authorization: Bearer ${SECRET}`,
    )
  })

  it('复制走 copyText——现场是纯 HTTP，navigator.clipboard 在那里不存在', async () => {
    const copy = vi.spyOn(clipboard, 'copyText').mockResolvedValue(true)
    mount(SecretRevealDialog, {
      props: { issued: { name: 'XX系统写点位', secret: SECRET } },
    })
    mount(DtToastHost)
    await flushPromises()
    await clickByText('复制')
    expect(copy).toHaveBeenCalledWith(SECRET)
  })

  it('复制失败时告诉人手动选中，而不是假装成功', async () => {
    vi.spyOn(clipboard, 'copyText').mockResolvedValue(false)
    mount(SecretRevealDialog, {
      props: { issued: { name: 'XX系统写点位', secret: SECRET } },
    })
    mount(DtToastHost)
    await flushPromises()
    await clickByText('复制')
    expect(document.body.textContent).toContain('请手动选中')
  })
})
