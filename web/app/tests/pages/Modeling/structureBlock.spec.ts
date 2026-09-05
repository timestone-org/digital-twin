/**
 * @fileoverview 契约：「模型内部长什么样」这一块画出来的样子——碎石图与载荷、
 * 重要性、部分依赖一条一张小图、训练取值区间、代表树，以及六样各自缺席时的退化。
 *
 * ⚠ 夹具照抄后端实测产出（`tree_regressor` 与 `pca` 的 `report()`），不自己编
 * 形状：编的那一份与真实块漂了之后，这里全绿而界面全错。
 * ⚠ 部分依赖必须一条曲线一张小图：每条曲线的横轴是它自己那一列的取值，温度
 * 0–40 与负荷 0–2000 并进同一根轴之后两条都读不出东西。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import BarList from '@/pages/Modeling/Canvas/components/BarList.vue'
import LoadingsGrid from '@/pages/Modeling/Canvas/components/LoadingsGrid.vue'
import ScatterPlot from '@/pages/Modeling/Canvas/components/ScatterPlot.vue'
import StructureBlock from '@/pages/Modeling/Canvas/components/StructureBlock.vue'
import TreeOutline from '@/pages/Modeling/Canvas/components/TreeOutline.vue'
import type { ReportBlock } from '@/pages/Modeling/Canvas/scripts/reportBlocks'

/** 20 个网格点的部分依赖曲线，照后端的等距网格造。 */
function curve(low: number, high: number, at: (x: number) => number) {
  const step = (high - low) / 19
  return Array.from({ length: 20 }, (_, seat): [number, number] => {
    const x = low + seat * step
    return [x, at(x)]
  })
}

/** 后端实测：`tree_regressor` 的「重要性、部分依赖与训练取值区间」。 */
const TREE_PAYLOAD = {
  importances: [
    { key: '台阶', value: 1 },
    { key: '噪声', value: 0 },
  ],
  ranges: [
    { key: '台阶', low: 0, high: 59 },
    { key: '噪声', low: 0, high: 2 },
  ],
  tree: {
    depth: 3,
    nodes: [
      {
        id: 0,
        parent: -1,
        branch: '',
        key: '台阶',
        threshold: 30,
        value: 46.666666666666664,
        samples: 39,
        is_leaf: false,
      },
      {
        id: 1,
        parent: 0,
        branch: 'low',
        key: '',
        threshold: null,
        value: 0,
        samples: 23,
        is_leaf: true,
      },
      {
        id: 2,
        parent: 0,
        branch: 'high',
        key: '',
        threshold: null,
        value: 100,
        samples: 16,
        is_leaf: true,
      },
    ],
  },
  pdp: [
    { key: '台阶', points: curve(0, 59, (x) => (x < 30 ? 0 : 100)) },
    { key: '噪声', points: curve(0, 2, () => 49.333333333333336) },
  ],
  loadings: [],
  explained: [],
  is_primary: true,
  notes: [
    {
      level: 'hint',
      text: '树不外推：某一列的输入落在训练取值区间之外时，预测值恒等于边界上的叶值',
    },
  ],
}

/** 后端实测：`pca` 的「解释方差与载荷」。 */
const PCA_PAYLOAD = {
  importances: [],
  ranges: [],
  tree: null,
  pdp: [],
  loadings: [
    [0.447202, 0.894404, 0.007241],
    [-0.003238, -0.006477, 0.999974],
  ],
  explained: [0.97571, 0.02429],
  is_primary: true,
  loading_rows: ['pc1', 'pc2'],
  loading_columns: ['甲', '乙', '丙'],
  cumulative: [0.97571, 1],
  is_loadings_cut: false,
}

const BLANK_PAYLOAD = {
  importances: [],
  ranges: [],
  tree: null,
  pdp: [],
  loadings: [],
  explained: [],
}

function blockOf(payload: Record<string, unknown>): ReportBlock {
  return {
    kind: 'structure',
    zone: 'charts',
    port: '',
    title: '模型内部',
    tier: 2,
    isPrimary: null,
    payload,
  }
}

function mounted(payload: Record<string, unknown>) {
  return mount(StructureBlock, { props: { block: blockOf(payload) } })
}

describe('树模型的四张图', () => {
  it('重要性与训练取值区间各走各的横条模式', () => {
    const bars = mounted(TREE_PAYLOAD).findAllComponents(BarList)

    expect(bars).toHaveLength(2)
    expect(bars[0]?.props('items')).toHaveLength(2)
    expect(bars[1]?.props('mode')).toBe('range')
  })

  it('重要性的结论点名最重要的那一列并给它的占比', () => {
    expect(mounted(TREE_PAYLOAD).text()).toContain(
      '共 2 列，最重要的是「台阶」1，占全部重要性的 100%',
    )
  })

  it('训练取值区间的结论必须说出「不外推」这条树独有的坑', () => {
    const text = mounted(TREE_PAYLOAD).text()

    expect(text).toContain('例如「台阶」0 ~ 59')
    expect(text).toContain('树只会给边界上的那个叶值')
  })

  it('部分依赖一条曲线一张小图，各带各的横轴名', () => {
    const plots = mounted(TREE_PAYLOAD).findAllComponents(ScatterPlot)

    expect(plots).toHaveLength(2)
    expect(plots[0]?.props('series')).toEqual([
      { name: '台阶', draw: 'both', points: TREE_PAYLOAD.pdp[0]?.points },
    ])
    expect(plots[0]?.props('xLabel')).toBe('台阶')
    expect(plots[1]?.props('xLabel')).toBe('噪声')
  })

  it('每条曲线下写清这一列从哪走到哪、预测值跟着变了多少', () => {
    const text = mounted(TREE_PAYLOAD).text()

    expect(text).toContain(
      '「台阶」从 0 走到 59，预测值随之从 0 变到 100，上下跨度 100',
    )
    expect(text).toContain('「噪声」从 0 走到 2')
    expect(text).toContain('上下跨度 0')
  })

  it('代表树的条件挂在父节点的列与阈值上，一层一级摆开', () => {
    const wrapper = mounted(TREE_PAYLOAD)
    const conditions = wrapper
      .findAll('.dt-ml-tree__when')
      .map((one) => one.text())

    expect(wrapper.findComponent(TreeOutline).exists()).toBe(true)
    expect(conditions).toEqual(['台阶 ≤ 30', '台阶 > 30'])
    expect(wrapper.text()).toContain('预测 0 · 23 行')
    expect(wrapper.text()).toContain('预测 100 · 16 行')
  })

  it('代表树的结论说清先按哪一列切在哪个值上', () => {
    expect(mounted(TREE_PAYLOAD).text()).toContain(
      '共 3 个节点：先按「台阶」切在 30 上，39 行分成两支',
    )
  })

  it('这一块的口径说明摆在这一块上', () => {
    expect(mounted(TREE_PAYLOAD).text()).toContain('树不外推')
  })
})

describe('主成分的两张图', () => {
  it('碎石图给每条轴一根条，累计曲线从零起画并带 80% 线', () => {
    const wrapper = mounted(PCA_PAYLOAD)
    const plot = wrapper.findComponent(ScatterPlot)

    expect(wrapper.findComponent(BarList).props('items')).toHaveLength(2)
    expect(plot.props('rules')).toEqual([
      { at: 0.8, label: '80% 够用线', intent: 'reference' },
    ])
    expect(plot.props('series')).toEqual([
      {
        name: '累计解释方差比',
        draw: 'both',
        points: [
          [0, 0],
          [1, 0.97571],
          [2, 1],
        ],
      },
    ])
  })

  it('结论回答「前几条够用」，百分数走百分数那一档', () => {
    expect(mounted(PCA_PAYLOAD).text()).toContain(
      '前 1 条就过了 80%，2 条合计解释掉 100%',
    )
  })

  it('一条都没过 80% 时照实说，不四舍五入成「够了」', () => {
    expect(
      mounted({
        ...PCA_PAYLOAD,
        explained: [0.4, 0.3],
        cumulative: [0.4, 0.7],
      }).text(),
    ).toContain('2 条轴合计也只解释掉 70%，没到 80%')
  })

  it('后端没给累计时按每条轴的占比自己加上去', () => {
    const series = mounted({ ...PCA_PAYLOAD, cumulative: [] })
      .findComponent(ScatterPlot)
      .props('series')

    expect(series).toEqual([
      {
        name: '累计解释方差比',
        draw: 'both',
        points: [
          [0, 0],
          [1, 0.97571],
          [2, 1],
        ],
      },
    ])
  })

  it('载荷一行一条轴、一列一个原列，负载荷另有一重非颜色编码', () => {
    const grid = mounted(PCA_PAYLOAD).findComponent(LoadingsGrid)

    expect(grid.findAll('.dt-ml-loadings__cell')).toHaveLength(6)
    expect(grid.findAll('.dt-ml-loadings__cell--negative')).toHaveLength(2)
  })

  it('方块面积按绝对值最大的那一格归一，最大的那格画满', () => {
    const cells = mounted(PCA_PAYLOAD)
      .findAll('.dt-ml-loadings__cell')
      .map((one) => Number(one.attributes('width')))

    expect(cells[5]).toBeCloseTo(13, 6)
    expect(cells[3]).toBeLessThan(1)
  })

  it('每一格挂着行名、列名与它的载荷，读数不靠颜色', () => {
    expect(
      mounted(PCA_PAYLOAD).findAll('.dt-ml-loadings__cell title')[0]?.text(),
    ).toBe('pc1 × 甲：0.4472')
  })

  it('结论点名最大的那一格并说清怎么读这张图', () => {
    expect(mounted(PCA_PAYLOAD).text()).toContain(
      '2 行 × 3 列；方块面积是载荷的绝对值、空心的是负载荷；最大的一格是 「pc2 × 丙」1',
    )
  })

  it('载荷截过时说清只画了几行几列', () => {
    expect(mounted({ ...PCA_PAYLOAD, is_loadings_cut: true }).text()).toContain(
      '只画了前 2 行 × 3 列',
    )
  })

  it('载荷全是零时照实说，不画一片空格子让人以为图坏了', () => {
    const wrapper = mounted({
      ...PCA_PAYLOAD,
      loadings: [
        [0, 0],
        [0, 0],
      ],
    })

    expect(wrapper.text()).toContain('载荷全是零，一格都画不出来')
    expect(
      wrapper
        .findAll('.dt-ml-loadings__cell')
        .map((one) => one.attributes('width')),
    ).toEqual(['0', '0', '0', '0'])
  })

  it('行列名读不出来时按第几条轴叫，不空着', () => {
    const wrapper = mounted({
      ...PCA_PAYLOAD,
      loading_rows: [],
      loading_columns: [],
    })

    expect(wrapper.find('.dt-ml-loadings__rows text').text()).toContain(
      '第 1 主成分',
    )
    expect(wrapper.text()).toContain('第 1 主成分')
  })

  it('长列名印到八个字为止，全名挂在格子上', () => {
    const wrapper = mounted({
      ...PCA_PAYLOAD,
      loading_columns: ['1#冷冻水泵出口温度与回水温度的差值', '乙', '丙'],
    })

    expect(wrapper.find('.dt-ml-loadings__cols text').text()).toContain(
      '1#冷冻水泵出口…',
    )
    expect(wrapper.find('.dt-ml-loadings__cols title').text()).toBe(
      '1#冷冻水泵出口温度与回水温度的差值',
    )
  })
})

describe('六样各自缺席时的退化', () => {
  it('一样都没有时给一句空态，且说清不是画法漏了', () => {
    const wrapper = mounted(BLANK_PAYLOAD)

    expect(wrapper.text()).toContain('这一块没有可画的模型内部结构')
    expect(wrapper.findAllComponents(BarList)).toHaveLength(0)
    expect(wrapper.findComponent(TreeOutline).exists()).toBe(false)
  })

  it('payload 整包读不出来时也不抛错', () => {
    expect(mounted({}).text()).toContain('这一块没有可画的模型内部结构')
  })

  it('只有重要性时不摆别的几张图的标题', () => {
    const wrapper = mounted({
      ...BLANK_PAYLOAD,
      importances: [{ key: '甲', value: 0.5 }],
    })

    expect(wrapper.findAllComponents(BarList)).toHaveLength(1)
    expect(wrapper.text()).not.toContain('训练取值区间')
  })

  it('重要性全算不出来时说「没有一列算得出重要性」', () => {
    expect(
      mounted({
        ...BLANK_PAYLOAD,
        importances: [{ key: '甲', value: null }],
      }).text(),
    ).toContain('共 1 列，没有一列算得出重要性')
  })

  it('曲线只有一个点时照实说，不画一条假的平线', () => {
    expect(
      mounted({
        ...BLANK_PAYLOAD,
        pdp: [{ key: '常数列', points: [[3, 7]] }],
      }).text(),
    ).toContain('「常数列」在训练集上只有 3 这一个取值，画不出曲线')
  })

  it('曲线一个点都没有时也说得出话', () => {
    expect(
      mounted({ ...BLANK_PAYLOAD, pdp: [{ key: '空列', points: [] }] }).text(),
    ).toContain('「空列」一个网格点都没有，画不出曲线')
  })

  it('代表树只剩一个根节点时不装成一棵树', () => {
    expect(
      mounted({
        ...BLANK_PAYLOAD,
        tree: {
          depth: 3,
          nodes: [
            {
              id: 0,
              parent: -1,
              branch: '',
              key: '',
              threshold: null,
              value: 5,
              samples: 12,
              is_leaf: true,
            },
          ],
        },
      }).text(),
    ).toContain('这棵代表树只有一个节点：预测 5 · 12 行')
  })

  it('三样都顶到上限时各说各的，不合成一句「数据不全」', () => {
    const wrapper = mounted({
      ...BLANK_PAYLOAD,
      importances: Array.from({ length: 60 }, (_, seat) => ({
        key: `第${seat}列`,
        value: 60 - seat,
      })),
      ranges: Array.from({ length: 60 }, (_, seat) => ({
        key: `第${seat}列`,
        low: 0,
        high: seat + 1,
      })),
      pdp: Array.from({ length: 10 }, (_, seat) => ({
        key: `第${seat}列`,
        points: curve(0, 9, (x) => x * seat),
      })),
    })

    expect(wrapper.text()).toContain('重要性顶到了上限 60 项')
    expect(wrapper.text()).toContain('训练取值区间顶到了上限 60 项')
    expect(wrapper.text()).toContain('部分依赖曲线顶到了上限 10 项')
  })

  it('解释方差顶到 20 条时也说一句', () => {
    expect(
      mounted({
        ...BLANK_PAYLOAD,
        explained: Array.from({ length: 20 }, () => 0.05),
      }).text(),
    ).toContain('解释方差顶到了上限 20 项')
  })

  it('代表树顶到 31 个节点时说清更深那几层没带回来', () => {
    const nodes = Array.from({ length: 31 }, (_, seat) => ({
      id: seat,
      parent: seat === 0 ? -1 : 0,
      branch: seat === 0 ? '' : 'low',
      key: seat === 0 ? '甲' : '',
      threshold: seat === 0 ? 1.5 : null,
      value: seat,
      samples: 100 - seat,
      is_leaf: seat !== 0,
    }))

    expect(
      mounted({ ...BLANK_PAYLOAD, tree: { depth: 3, nodes } }).text(),
    ).toContain('节点数顶到了上限 31 个')
  })

  it('树里有一条自环的坏边时不转死，也不静默丢掉那个节点', () => {
    const wrapper = mounted({
      ...BLANK_PAYLOAD,
      tree: {
        depth: 3,
        nodes: [
          {
            id: 0,
            parent: -1,
            branch: '',
            key: '甲',
            threshold: 1,
            value: 1,
            samples: 9,
            is_leaf: false,
          },
          {
            id: 1,
            parent: 1,
            branch: 'low',
            key: '',
            threshold: null,
            value: 2,
            samples: 4,
            is_leaf: true,
          },
        ],
      },
    })

    expect(wrapper.findAll('.dt-ml-tree__node')).toHaveLength(2)
  })

  it('父节点的切分条件读不出来时照实说，不编一个阈值', () => {
    const wrapper = mounted({
      ...BLANK_PAYLOAD,
      tree: {
        depth: 3,
        nodes: [
          {
            id: 0,
            parent: -1,
            branch: '',
            key: '甲',
            threshold: null,
            value: 1,
            samples: 9,
            is_leaf: false,
          },
          {
            id: 1,
            parent: 0,
            branch: 'low',
            key: '',
            threshold: null,
            value: 2,
            samples: 4,
            is_leaf: true,
          },
        ],
      },
    })

    expect(wrapper.find('.dt-ml-tree__when').text()).toBe(
      '（切分条件读不出来）',
    )
    expect(wrapper.text()).toContain('这棵代表树只有一个节点')
  })

  it('代表树是空清单时当成没有树', () => {
    expect(
      mounted({ ...BLANK_PAYLOAD, tree: { depth: 3, nodes: [] } }).text(),
    ).toContain('这一块没有可画的模型内部结构')
  })
})

/** 后端实测：`linear_regression` 的「残差对预测值」。 */
const RESIDUAL_PAYLOAD = {
  importances: [],
  ranges: [],
  tree: null,
  pdp: [],
  clouds: [
    {
      key: 'residual',
      name: '残差',
      mode: 'residual',
      x_label: '预测值（千瓦时）',
      y_label: '残差（千瓦时）',
      points: [
        [1245.8, 40],
        [1385, 40],
        [1524.21, 40],
      ],
    },
  ],
  loadings: [],
  explained: [],
  is_primary: true,
}

describe('线性回归的诊断散点', () => {
  it('一张图一块散点，画法与轴名照后端给的走', () => {
    const plots = mounted(RESIDUAL_PAYLOAD).findAllComponents(ScatterPlot)

    expect(plots).toHaveLength(1)
    expect(plots[0]?.props('mode')).toBe('residual')
    expect(plots[0]?.props('xLabel')).toBe('预测值（千瓦时）')
    expect(plots[0]?.props('yLabel')).toBe('残差（千瓦时）')
  })

  // ⚠ 这一块只有散点：漏了它的话空态会盖在图上，读起来是「这一步什么都没算」
  it('只有散点时不摆空态', () => {
    expect(mounted(RESIDUAL_PAYLOAD).text()).not.toContain(
      '这一块没有可画的模型内部结构',
    )
  })

  it('两张散点各摆一张，不并进同一张', () => {
    const clouds = RESIDUAL_PAYLOAD.clouds
    const plots = mounted({
      ...RESIDUAL_PAYLOAD,
      clouds: [...clouds, { ...clouds[0], key: 'truth', mode: 'pairs' }],
    }).findAllComponents(ScatterPlot)

    expect(plots).toHaveLength(2)
    expect(plots[1]?.props('mode')).toBe('pairs')
  })

  it('一张散点都没有时照旧摆空态', () => {
    expect(mounted({ ...RESIDUAL_PAYLOAD, clouds: [] }).text()).toContain(
      '这一块没有可画的模型内部结构',
    )
  })
})
