/**
 * @fileoverview DtSkeleton 的行数归一与形状契约。
 * ⚠ 非整数行数会让 `v-for="n in lines"` 拿到小数，Vue 直接渲染 0 个子节点——
 * 表现是「加载态什么都不显示」，而不是报错。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DtSkeleton from '../../src/components/DtSkeleton/DtSkeleton.vue'

type SkeletonProps = InstanceType<typeof DtSkeleton>['$props']

function lineCount(props: Partial<SkeletonProps>): number {
  return mount(DtSkeleton, { props }).findAll('.dt-skeleton--line').length
}

describe('DtSkeleton 形状', () => {
  it('缺省是一整块', () => {
    const wrapper = mount(DtSkeleton)
    expect(wrapper.find('.dt-skeleton--block').exists()).toBe(true)
    expect(wrapper.find('.dt-skeleton-lines').exists()).toBe(false)
  })

  it('circle 时圆角拉满，用于头像', () => {
    const wrapper = mount(DtSkeleton, { props: { circle: true } })
    expect(wrapper.find('.dt-skeleton').classes()).toContain(
      'dt-skeleton--circle',
    )
  })

  it('多行模式下不再渲染整块', () => {
    const wrapper = mount(DtSkeleton, { props: { lines: 3 } })
    expect(wrapper.find('.dt-skeleton--block').exists()).toBe(false)
  })

  it('circle 对多行模式无效：那是两种形状', () => {
    const wrapper = mount(DtSkeleton, { props: { lines: 2, circle: true } })
    expect(wrapper.find('.dt-skeleton--circle').exists()).toBe(false)
  })
})

describe('DtSkeleton 行数', () => {
  it('按行数渲染', () => {
    expect(lineCount({ lines: 3 })).toBe(3)
  })

  it('单行也走多行分支', () => {
    expect(lineCount({ lines: 1 })).toBe(1)
  })

  it.each([0, -2])('%j 行退回整块', (lines) => {
    expect(lineCount({ lines })).toBe(0)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    '⚠ %j 行退回整块，不让 v-for 拿到非整数',
    (lines) => {
      expect(lineCount({ lines })).toBe(0)
    },
  )

  it('小数行数向下取整', () => {
    expect(lineCount({ lines: 2.7 })).toBe(2)
  })
})

describe('DtSkeleton 行宽', () => {
  function widths(lines: number): (string | undefined)[] {
    return mount(DtSkeleton, { props: { lines } })
      .findAll('.dt-skeleton--line')
      .map((line) => line.attributes('style'))
  }

  it('末行短一截，像一段自然结束的文字', () => {
    const styles = widths(3)
    expect(styles[0]).toContain('100%')
    expect(styles[2]).toContain('60%')
  })

  it('只有一行时铺满：一行就收窄会看着像出错', () => {
    expect(widths(1)[0]).toContain('100%')
  })
})
