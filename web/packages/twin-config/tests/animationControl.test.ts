/** @fileoverview 动画规则的边界、无效数据和比较语义。 */
import { expect, it } from 'vitest'
import {
  animationCondition,
  normalizeAnimationControls,
  animationValuesOf,
} from '../src/animationControl'
it.each([
  ['eq', 1, true],
  ['neq', 1, false],
  ['gt', 2, true],
  ['gte', 1, true],
  ['lt', 0, true],
  ['lte', 1, true],
] as const)('%s 比较条件', (operator, value, result) => {
  const control = normalizeAnimationControls([{ clip: 'a', operator }])[0]
  if (control === undefined) throw new Error('missing control')
  expect(animationCondition(control, value)).toBe(result)
  expect(animationCondition(control, null)).toBeNull()
  expect(animationCondition(control, '')).toBeNull()
})
it('去重空名、过滤非法形状、限制速度并保留控制选项', () => {
  expect(normalizeAnimationControls(null)).toEqual([])
  const controls = normalizeAnimationControls([
    null,
    1,
    {},
    {
      clip: '  a  ',
      mode: 'always',
      speed: 100,
      loop: 'once',
      stop: 'reset',
      missing: 'reset',
      restart: true,
    },
    { clip: 'a' },
  ])
  expect(controls).toEqual([
    {
      clip: 'a',
      name: '',
      mode: 'always',
      speed: 4,
      loop: 'once',
      stop: 'reset',
      missing: 'reset',
      restart: true,
      operator: 'eq',
      threshold: 1,
    },
  ])
  expect(animationValuesOf(controls, undefined)).toEqual({ a: null })
  expect(animationValuesOf(controls, [{ value: 0 }])).toEqual({ a: 0 })
})
