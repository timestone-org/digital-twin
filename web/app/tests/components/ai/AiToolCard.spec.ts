/**
 * @fileoverview 契约：一步做了什么要看得见——失败要与成功一眼分得开，
 * 入参与产出要展得开，截图要画出来。
 *
 * 只有一句标题的话，用户看到的是「助手做了几件事然后给了个奇怪的答复」，
 * 而看不出中间哪一步没成、也看不出它到底把什么写进去了。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { DtIcon } from '@dt/ui'

import AiToolCard from '@/components/ai/AiToolCard.vue'
import type { RunnerStep } from '@/features/ai/turnRunner'

const SHOT = 'data:image/png;base64,iVBORw0KGgo='

function step(overrides: Partial<RunnerStep> = {}): RunnerStep {
  return {
    kind: 'model',
    name: 'model',
    state: 'succeeded',
    title: '想了想',
    error: null,
    ...overrides,
  }
}

describe('步骤卡', () => {
  it('摆出这一步的说明', () => {
    const wrapper = mount(AiToolCard, { props: { step: step() } })
    expect(wrapper.text()).toContain('想了想')
  })

  it('失败的一步带上失败标记', () => {
    const wrapper = mount(AiToolCard, {
      props: { step: step({ state: 'failed' }) },
    })
    expect(wrapper.find('.ai-step--failed').exists()).toBe(true)
  })

  it('失败原因摆在下面一行，不藏起来', () => {
    const wrapper = mount(AiToolCard, {
      props: { step: step({ state: 'failed', error: '这个槽不存在' }) },
    })
    expect(wrapper.text()).toContain('这个槽不存在')
  })

  it('等页面执行的那一步不是失败', () => {
    const wrapper = mount(AiToolCard, {
      props: { step: step({ kind: 'client_tool', state: 'awaiting_client' }) },
    })
    expect(wrapper.find('.ai-step--failed').exists()).toBe(false)
    expect(wrapper.text()).toContain('等页面执行')
  })

  it('认不出的种类也照样渲染，不留空行', () => {
    const wrapper = mount(AiToolCard, {
      props: { step: step({ kind: 'something-new', title: '新花样' }) },
    })
    expect(wrapper.text()).toContain('新花样')
  })

  it('没东西可展开时那一行是禁用的', () => {
    // 不禁用的话，点上去什么都不发生——而用户会以为自己点错了地方
    const wrapper = mount(AiToolCard, { props: { step: step() } })
    expect(wrapper.get('.ai-step__head').attributes('disabled')).toBeDefined()
  })

  it('展开之后看得见入参与产出', async () => {
    const wrapper = mount(AiToolCard, {
      props: {
        step: step({
          kind: 'server_tool',
          input: { q: '温度' },
          output: '命中 3 条',
        }),
      },
    })
    expect(wrapper.find('.ai-step__detail').exists()).toBe(false)
    await wrapper.get('.ai-step__head').trigger('click')
    expect(wrapper.text()).toContain('温度')
    expect(wrapper.text()).toContain('命中 3 条')
  })

  it('折叠时展示简短概要，展开旧 JSON 时显示表格与分页信息', async () => {
    const wrapper = mount(AiToolCard, {
      props: {
        step: step({
          kind: 'server_tool',
          output: JSON.stringify({
            items: [
              { id: 'p1', name: '温度' },
              { id: 'p2', name: '压力' },
            ],
            metadata: { total: 40, has_more: true, next_page: 2 },
          }),
        }),
      },
    })
    expect(wrapper.text()).toContain('返回 2 条结果')
    expect(wrapper.find('table').exists()).toBe(false)
    await wrapper.get('.ai-step__head').trigger('click')
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
    expect(wrapper.text()).toContain('metadata.next_page')
    expect(wrapper.text()).toContain('温度')
    expect(wrapper.text()).not.toContain('"items"')
    await wrapper.get('.ai-step__head').trigger('click')
    expect(wrapper.find('table').exists()).toBe(false)
  })

  it('新紧凑文本渲染为列表，危险内容只显示文字', async () => {
    const wrapper = mount(AiToolCard, {
      props: {
        step: step({
          output:
            '- count: 2\n- 说明: <img src=x onerror="alert(1)">\n- [链接](javascript:alert(1))',
        }),
      },
    })
    await wrapper.get('.ai-step__head').trigger('click')
    expect(wrapper.find('.ai-step__out ul').exists()).toBe(true)
    expect(wrapper.find('.ai-step__out img').exists()).toBe(false)
    expect(wrapper.find('.ai-step__out a').exists()).toBe(false)
    expect(wrapper.text()).toContain('<img src=x')
  })

  it('旧 JSON 中的点位编码与名称标记按原文显示', async () => {
    const wrapper = mount(AiToolCard, {
      props: {
        step: step({ output: '[{"node_key":"src:KY_DC_5","name":"**泵**"}]' }),
      },
    })
    await wrapper.get('.ai-step__head').trigger('click')
    expect(wrapper.text()).toContain('src:KY_DC_5')
    expect(wrapper.text()).toContain('**泵**')
    expect(wrapper.find('strong').exists()).toBe(false)
  })

  it('完整来源的展示载体优先于原始截断预览，并沿用安全渲染', async () => {
    const wrapper = mount(AiToolCard, {
      props: {
        step: step({
          output: '{"items":[原始预览已截断',
          displaySummary: '返回 20 条结果',
          displayOutput:
            '| id | name |\n| --- | --- |\n| p1 | <script>alert(1)</script> |',
        }),
      },
    })
    expect(wrapper.text()).toContain('返回 20 条结果')
    await wrapper.get('.ai-step__head').trigger('click')
    expect(wrapper.find('table').exists()).toBe(true)
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.text()).toContain('<script>alert(1)</script>')
    expect(wrapper.text()).not.toContain('原始预览已截断')
  })

  it('截图画成缩略图，不是一坨 base64', async () => {
    const wrapper = mount(AiToolCard, {
      props: {
        step: step({
          kind: 'client_tool',
          name: 'dashboard.capture',
          image: SHOT,
        }),
      },
    })
    await wrapper.get('.ai-step__head').trigger('click')
    expect(wrapper.get('.ai-step__shot-btn img').attributes('src')).toBe(SHOT)
    // 原样打印的话，几十万字符会把整条时间线冲垮
    expect(wrapper.text()).not.toContain('base64')
  })

  it('图被释放掉的那一步说一句人话', async () => {
    const wrapper = mount(AiToolCard, {
      props: { step: step({ kind: 'client_tool', isImageDropped: true }) },
    })
    await wrapper.get('.ai-step__head').trigger('click')
    expect(wrapper.text()).toContain('截图已释放')
    expect(wrapper.find('.ai-step__shot-btn').exists()).toBe(false)
  })
})

describe('步骤卡终态标记', () => {
  it.each(['aborted', 'cancelled'])('%s明确停止且不能显示成功勾号', (state) => {
    const wrapper = mount(AiToolCard, {
      props: { step: step({ state, title: '工具停下了' }) },
    })
    expect(wrapper.text()).toContain('已停止')
    expect(
      wrapper.findAllComponents(DtIcon).map((icon) => icon.props('name')),
    ).not.toContain('check')
    expect(wrapper.find('.ai-step--stopped').exists()).toBe(true)
  })
  it.each(['unknown', 'new-state'])(
    '%s明确未确认且不能显示成功勾号',
    (state) => {
      const wrapper = mount(AiToolCard, { props: { step: step({ state }) } })
      expect(wrapper.text()).toContain('状态未确认')
      expect(
        wrapper.findAllComponents(DtIcon).map((icon) => icon.props('name')),
      ).not.toContain('check')
    },
  )
})

it('只有成功终态显示勾号，运行中的步骤保持执行提示', () => {
  const succeeded = mount(AiToolCard, { props: { step: step() } })
  expect(
    succeeded.findAllComponents(DtIcon).map((icon) => icon.props('name')),
  ).toContain('check')
  const running = mount(AiToolCard, {
    props: { step: step({ state: 'running' }) },
  })
  expect(running.text()).toContain('执行中')
  expect(
    running.findAllComponents(DtIcon).map((icon) => icon.props('name')),
  ).not.toContain('check')
})
