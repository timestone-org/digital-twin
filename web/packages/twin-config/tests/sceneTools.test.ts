/**
 * @fileoverview 守场景工具纯逻辑的口径：图例去重且与渲染共用色表、截图文件名
 * 不落到别的目录、剖切用归一化位置、搜索的相关性排序与截断如实报数、
 * 测距不编单位。
 */
import { describe, expect, it } from 'vitest'

import { flowKindColor } from '../src/flowColors'
import { normalizeTwinConfig } from '../src/normalize'
import {
  clipPlaneFor,
  collectSceneLegend,
  formatMeasureDistance,
  measureDistance,
  screenshotFileName,
  screenshotStamp,
  searchSceneEntities,
} from '../src/sceneTools'
import type { TwinFlowLink, TwinHierNode, TwinPart } from '../src/types'

function flowsOf(...kinds: string[]): TwinFlowLink[] {
  return normalizeTwinConfig({
    flows: kinds.map((kind, index) => ({ id: `f${index}`, kind })),
  }).flows
}

describe('颜色图例', () => {
  it('每个种类只列一次——十条能流共用一套种类是常态', () => {
    const legend = collectSceneLegend(flowsOf('water', 'water', 'steam'))

    expect(legend.map((item) => item.label)).toEqual(['water', 'steam'])
  })

  // 缺省色代表什么本身没有含义，列出来只会让人去猜
  it('没写种类的流不进图例', () => {
    expect(collectSceneLegend(flowsOf('', '  '))).toEqual([])
  })

  // ⚠ 图例的色块与画面上的管线必须同源，否则用户照着图例认的颜色是错的
  it('颜色取自与渲染层共用的那份色表', () => {
    const legend = collectSceneLegend(flowsOf('water'))

    expect(legend[0]?.color).toBe(flowKindColor('water'))
  })

  it('认得的种类给出主题 token，供渲染侧优先取用', () => {
    const legend = collectSceneLegend(flowsOf('steam'))

    expect(legend[0]?.token).toBe('--flow-steam')
  })

  it('种类名带空格时拼不出合法变量名，token 给 null', () => {
    const legend = collectSceneLegend(flowsOf('冷 却 水'))

    expect(legend[0]?.token).toBeNull()
  })
})

describe('截图文件名', () => {
  it('标题里的路径字符换成横线，别落到别的目录去', () => {
    expect(screenshotFileName('一号/车间', '20260804-123456')).toBe(
      '一号-车间-20260804-123456.png',
    )
  })

  it('标题为空时回退，不产出以横线开头的裸时间戳', () => {
    expect(screenshotFileName('   ', '20260804-123456')).toBe(
      'twin-scene-20260804-123456.png',
    )
  })

  it('首尾的横线削掉', () => {
    expect(screenshotFileName('  //厂区//  ', '1')).toBe('厂区-1.png')
  })

  it('过长的标题截断', () => {
    const name = screenshotFileName('长'.repeat(200), '1')

    expect(name.length).toBeLessThan(80)
  })

  it('时间戳去掉冒号与毫秒', () => {
    expect(screenshotStamp('2026-08-04T12:34:56.789Z')).toBe('20260804-123456')
  })

  it('时刻串对不上格式时给 unknown，不拼出半个文件名', () => {
    expect(screenshotStamp('昨天')).toBe('unknown')
  })
})

describe('剖切平面', () => {
  it('不剖切时给 null', () => {
    expect(clipPlaneFor('none', 0.5, 0, 10)).toBeNull()
  })

  it('包围盒退化时给 null，不切出一个空模型', () => {
    expect(clipPlaneFor('x', 0.5, 5, 5)).toBeNull()
    expect(clipPlaneFor('x', 0.5, 10, 5)).toBeNull()
    expect(clipPlaneFor('x', 0.5, Number.NaN, 5)).toBeNull()
  })

  it('归一化位置落在包围盒里：0 是下界、1 是上界', () => {
    expect(clipPlaneFor('y', 0, -4, 6)?.constant).toBe(-4)
    expect(clipPlaneFor('y', 1, -4, 6)?.constant).toBe(6)
    expect(clipPlaneFor('y', 0.5, -4, 6)?.constant).toBe(1)
  })

  it('位置超界自动夹取，不把切面甩到模型外面', () => {
    expect(clipPlaneFor('z', 5, 0, 10)?.constant).toBe(10)
    expect(clipPlaneFor('z', -3, 0, 10)?.constant).toBe(0)
    expect(clipPlaneFor('z', Number.NaN, 0, 10)?.constant).toBe(5)
  })

  it('三个轴各自取自己的负法向', () => {
    expect(clipPlaneFor('x', 0.5, 0, 2)?.normal).toEqual([-1, 0, 0])
    expect(clipPlaneFor('y', 0.5, 0, 2)?.normal).toEqual([0, -1, 0])
    expect(clipPlaneFor('z', 0.5, 0, 2)?.normal).toEqual([0, 0, -1])
  })
})

describe('场景内搜索', () => {
  const parts: TwinPart[] = normalizeTwinConfig({
    parts: [
      { id: 'p1', name: 'Pump', nodes: ['pump-01'] },
      { id: 'p2', name: 'Pump_Assembly_Housing', nodes: ['pump-02'] },
      { id: 'p3', name: '风机', nodes: ['fan'] },
    ],
  }).parts
  const hierNodes: TwinHierNode[] = normalizeTwinConfig({
    hierNodes: [{ id: 'h1', name: '一号车间', nodes: ['ws1'] }],
  }).hierNodes
  const source = { parts, hierNodes, namedNodes: ['pump-01', 'valve'] }

  it('空搜索词给空结果，不把整份清单倒出来', () => {
    expect(searchSceneEntities('   ', source)).toEqual({ hits: [], total: 0 })
  })

  it('前缀命中排在子串命中前面', () => {
    const { hits } = searchSceneEntities('pump', source)

    expect(hits[0]?.label).toBe('Pump')
  })

  // 搜 pump 时 Pump 该排在 Pump_Assembly_Housing 前面
  it('同档里名字更短的更相关', () => {
    const { hits } = searchSceneEntities('pump', source)
    const labels = hits.map((hit) => hit.label)

    expect(labels.indexOf('Pump')).toBeLessThan(
      labels.indexOf('Pump_Assembly_Housing'),
    )
  })

  it('大小写不敏感', () => {
    expect(searchSceneEntities('PUMP', source).total).toBeGreaterThan(0)
  })

  it('三类实体都搜得到，且各自带上定位用的节点名', () => {
    const kinds = new Set(
      searchSceneEntities('p', source).hits.map((hit) => hit.kind),
    )

    expect(kinds.has('part')).toBe(true)
    expect(kinds.has('node')).toBe(true)
    expect(searchSceneEntities('车间', source).hits[0]?.nodes).toEqual(['ws1'])
  })

  // ⚠ 截断了要如实报数，否则用户以为搜到的就这些
  it('截断时 total 仍是命中总数', () => {
    const result = searchSceneEntities('pump', source, 1)

    expect(result.hits).toHaveLength(1)
    expect(result.total).toBeGreaterThan(1)
  })

  it('一条都没命中时给空结果', () => {
    expect(searchSceneEntities('不存在的东西', source).total).toBe(0)
  })
})

describe('两点测距', () => {
  it('算的是三维直线距离', () => {
    expect(measureDistance([0, 0, 0], [3, 4, 0])).toBe(5)
  })

  it('少一个点时给 NaN，调用方按测不出处理', () => {
    expect(measureDistance(null, [1, 1, 1])).toBeNaN()
    expect(measureDistance([1, 1, 1], null)).toBeNaN()
  })

  it('坐标里有非有限值时给 NaN', () => {
    expect(measureDistance([0, 0, 0], [Number.NaN, 1, 1])).toBeNaN()
    expect(
      measureDistance([0, 0, 0], [Number.POSITIVE_INFINITY, 1, 1]),
    ).toBeNaN()
  })

  // ⚠ 世界单位是无量纲的，编一个「m」出来在按毫米建模的图纸上就是错的
  it('展示文本不带单位', () => {
    expect(formatMeasureDistance(12.345)).not.toContain('m')
  })

  it('按量级选小数位：大的取整、小的保留三位', () => {
    expect(formatMeasureDistance(123.456)).toBe('123')
    expect(formatMeasureDistance(12.345)).toBe('12.35')
    expect(formatMeasureDistance(0.5034)).toBe('0.503')
  })

  it('末尾的零削掉', () => {
    expect(formatMeasureDistance(2.5)).toBe('2.5')
    expect(formatMeasureDistance(2)).toBe('2')
  })

  it('测不出时给一个破折号，而不是 NaN 上屏', () => {
    expect(formatMeasureDistance(Number.NaN)).toBe('—')
    expect(formatMeasureDistance(-1)).toBe('—')
  })
})
