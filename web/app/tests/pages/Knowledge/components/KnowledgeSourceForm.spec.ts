/** @fileoverview 来源表单只接受平台路径与明确的资料可见性确认。 */
import { afterEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import KnowledgeSourceForm from '@/pages/Knowledge/components/KnowledgeSourceForm.vue'

enableAutoUnmount(afterEach)

async function validForm() {
  const wrapper = mount(KnowledgeSourceForm, { props: { isBusy: false } })
  await wrapper.get('input[name="source-name"]').setValue(' 平台台账 ')
  await wrapper
    .get('input[name="source-path"]')
    .setValue('/api/v1/platform/dataset-tables')
  return wrapper
}

describe('平台来源配置', () => {
  it('必须明确确认资料可见范围，提交所有已声明字段', async () => {
    const wrapper = await validForm()
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('submit')).toEqual([
      [
        '平台台账',
        {
          path: '/api/v1/platform/dataset-tables',
          id_field: 'row_id',
          title_field: '',
          page_param: 'page',
          size_param: 'size',
        },
      ],
    ])
  })

  it.each([
    'https://example.invalid/',
    '//example.invalid/a',
    '/api/v1/auth/users',
    '/api/v1/platform/a?token=x',
    '/api/v1/platform/a#x',
    '/api/v1/platform/../a',
    '/api/v1/platform/%2e%2e/a',
    '/api/v1/platform//a',
  ])('拒绝平台资源路径以外的 %s', async (path) => {
    const wrapper = await validForm()
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.get('input[name="source-path"]').setValue(path)
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.text()).toContain('不含域名')
  })

  it('拒绝目前无法分页读取的台账记录游标接口', async () => {
    const wrapper = await validForm()
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper
      .get('input[name="source-path"]')
      .setValue('/api/v1/platform/dataset-tables/table-id/records')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.text()).toContain('不能读取使用 after 游标')
  })

  it('不接受互相覆盖的页码/大小参数，或空行标识', async () => {
    const wrapper = await validForm()
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.get('input[name="source-size-param"]').setValue('page')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.text()).toContain('参数名不能相同')
    await wrapper.get('input[name="source-size-param"]').setValue('size')
    await wrapper.get('input[name="source-id-field"]').setValue(' ')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toBeUndefined()
  })

  it('名称边界按后端120个Unicode字符，而非UTF16长度', async () => {
    const wrapper = await validForm()
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.get('input[name="source-name"]').setValue('X'.repeat(121))
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toBeUndefined()
    await wrapper.get('input[name="source-name"]').setValue('😀'.repeat(120))
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')?.[0]?.[0]).toBe('😀'.repeat(120))
    expect(
      wrapper.get('input[name="source-path"]').attributes('placeholder'),
    ).toContain('dataset-tables')
  })

  it('提交期间锁住输入，Enter不能重复提交；告知外层草稿保护', async () => {
    const wrapper = await validForm()
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.setProps({ isBusy: true })
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(
      wrapper
        .findAll('input')
        .every((input) => input.attributes('disabled') !== undefined),
    ).toBe(true)
    expect(wrapper.emitted('dirty')?.at(-1)).toEqual([true])
  })
})
