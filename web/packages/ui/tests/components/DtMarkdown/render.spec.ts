/**
 * @fileoverview 契约：markdown 真的被渲染成结构，而且渲染不出可执行的东西。
 *
 * 这里最要紧的是最后一组：整条链路上一处 `v-html` 都没有，所以正文里复读回来
 * 的一段 HTML 只会原样显示成几个字。这条一旦破了，界面上看不出任何异样，
 * 而这个组件渲染的是模型生成的、不可信的文字。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DtMarkdown from '../../../src/components/DtMarkdown/DtMarkdown.vue'

function render(text: string) {
  return mount(DtMarkdown, { props: { text } })
}

describe('正文渲染', () => {
  it('列表渲染成真的列表', () => {
    const wrapper = render('- 甲\n- 乙')

    expect(wrapper.findAll('li')).toHaveLength(2)
  })

  it('有序列表沿用它自己的起始序号', () => {
    const wrapper = render('3. 丙\n4. 丁')

    expect(wrapper.find('ol').attributes('start')).toBe('3')
  })

  it('代码块单独一块，不掺进段落', () => {
    const wrapper = render('看这个：\n\n```json\n{"a":1}\n```')

    expect(wrapper.find('pre code').text()).toBe('{"a":1}')
  })

  it('表格渲染成表格', () => {
    const wrapper = render('| 槽位 | 点位 |\n| --- | --- |\n| 温度 | K1 |')

    expect(wrapper.findAll('th')).toHaveLength(2)
    expect(wrapper.findAll('td')).toHaveLength(2)
  })

  it('粗体与行内代码各自成元素', () => {
    const wrapper = render('**要紧**：写 `items`')

    expect(wrapper.find('strong').text()).toBe('要紧')
    expect(wrapper.find('code').text()).toBe('items')
  })

  it('斜体与删除线各自成元素', () => {
    const wrapper = render('*斜的* 与 ~~划掉的~~')

    expect(wrapper.find('em').text()).toBe('斜的')
    expect(wrapper.find('del').text()).toBe('划掉的')
  })

  it('引用块单独成块', () => {
    const wrapper = render('> 保存之后才会有实时数值')

    expect(wrapper.find('blockquote').text()).toContain('保存之后')
  })

  it('标题降级渲染，不抢页面标题的层级', () => {
    const wrapper = render('## 做法')

    expect(wrapper.find('h4').text()).toBe('做法')
  })
})

describe('不许渲染出可执行的东西', () => {
  it('正文里复读回来的 HTML 原样显示成文字', () => {
    const wrapper = render('注意 <script>alert(1)</script> 这一段')

    // 一处 v-html 都没有，所以这里进来的只可能是文本节点
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.text()).toContain('<script>alert(1)</script>')
  })

  it('img 标签也一样，不会去发请求', () => {
    const wrapper = render('<img src=x onerror="alert(1)">')

    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('协议不在白名单里的链接不生成可点的 a', () => {
    const wrapper = render('[点我](javascript:alert(1))')

    // 它看起来与普通链接一模一样，而点下去会执行
    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.text()).toContain('点我')
  })

  it('正常外链带上 noopener', () => {
    const wrapper = render('[文档](https://example.com)')

    // 不带的话新开的那一页能通过 window.opener 把本页导航走
    expect(wrapper.find('a').attributes('rel')).toContain('noopener')
  })
})
