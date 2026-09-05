/**
 * @fileoverview 结果面的六区骨架：分区、页签、折叠、四档截断与老运行的退化。
 *
 * ⚠ 四档「没有」一档都不许合并（规格 §2-P5），而「没有讲解的老运行」必须
 * 一个字不多地退回升级前的样子（§4.7）——这两条一旦破，界面上看着都很正常。
 */
import type { ModelingNodeRun } from '@dt/contracts'
import { DtModal } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ProvenanceBar from '@/pages/Modeling/Canvas/components/ProvenanceBar.vue'
import ResultDialog from '@/pages/Modeling/Canvas/components/ResultDialog.vue'
import ReportBlocks from '@/pages/Modeling/Canvas/components/ReportBlocks.vue'
import ResultView from '@/pages/Modeling/Canvas/components/ResultView.vue'
import TruncationNotice from '@/pages/Modeling/Canvas/components/TruncationNotice.vue'
import UnknownView from '@/pages/Modeling/Canvas/components/UnknownView.vue'

const FRAME_BODY = {
  kind: 'frame',
  shape: { rows: 500, cols: 2 },
  columns: [
    {
      key: 'power',
      name: '功率',
      dtype: 'number',
      role: 'feature',
      unit: 'kW',
      null_ratio: 0.5,
      n_unique: 3,
      min: 1,
      max: 9,
      mean: 5,
      p50: 4,
    },
  ],
  index_name: '时刻',
  index_head: [1788331980000],
  head: [[1]],
  rows_truncated: false,
  cols_truncated: false,
  provenance: {
    table_codes: ['energy_log'],
    since: '2026-01-01T00:00:00Z',
    until: '2026-09-01T00:00:00Z',
    is_truncated: true,
  },
}

const FRAME = { frame: FRAME_BODY }

const FRAME_URL = '/api/v1/platform/modeling-runs/r1/frames/n1?port=frame'

function blockOf(over: Record<string, unknown> = {}) {
  return {
    kind: 'rows',
    zone: 'step',
    port: '',
    title: '取数漏斗',
    tier: 0,
    payload: { before: 12, after: 8 },
    ...over,
  }
}

/** 一段话里某个记号出现了几次。 */
function countOf(text: string, mark: string): number {
  return text.split(mark).length - 1
}

function reportOf(blocks: Record<string, unknown>[]) {
  return { blocks, dropped: [], note: '' }
}

describe('四档截断各说各的', () => {
  it('取数触顶说的是「更早的没进来」，方向不指反', () => {
    const text = mount(TruncationNotice, {
      props: { kind: 'source' },
    }).text()

    expect(text).toContain('最新')
    expect(text).toContain('更早')
  })

  it('字节预算那一档把丢掉的块照标题点名', () => {
    const text = mount(TruncationNotice, {
      props: { kind: 'budget', dropped: ['载荷热力', '前后叠图'] },
    }).text()

    expect(text).toContain('载荷热力')
    expect(text).toContain('前后叠图')
  })

  // ⚠ 这一档说的是「摘要装不下、块被削掉了」：数据是全的，缺的只是讲解。
  // 换成一句笼统的「数据不全」，用户会跑去改取数范围或重跑这一步
  it('字节预算那一档说的是摘要装不下，不是数据没进来', () => {
    const text = mount(TruncationNotice, { props: { kind: 'budget' } }).text()

    expect(text).toContain('没能存下来')
    expect(text).toContain('数据本身没受影响')
    expect(text).not.toContain('取数')
    expect(text).not.toContain('重跑')
  })

  it('上游被削与这一屏被削不是同一句话', () => {
    const upstream = mount(TruncationNotice, { props: { kind: 'upstream' } })
    const budget = mount(TruncationNotice, { props: { kind: 'budget' } })

    expect(upstream.text()).toContain('上一步')
    expect(upstream.text()).not.toBe(budget.text())
  })

  it('老运行没记这一项，说的是重跑而不是数据不全', () => {
    const text = mount(TruncationNotice, { props: { kind: 'missing' } }).text()

    expect(text).toContain('重跑')
    expect(text).not.toContain('取数')
  })
})

describe('没有讲解的运行退回升级前的样子', () => {
  it('report 为 null 时不摆锚点条、不折叠完整数据', () => {
    const wrapper = mount(ResultView, {
      props: { payload: FRAME, report: null },
    })

    expect(wrapper.find('.dt-ml-result__anchors').exists()).toBe(false)
    expect(wrapper.find('.dt-ml-result__toggle').exists()).toBe(false)
    expect(wrapper.text()).toContain('空值率')
  })

  it('report 为 null 时不摆出处行，也不多说一句截断', () => {
    const wrapper = mount(ResultView, {
      props: { payload: FRAME, report: null },
    })

    expect(wrapper.findComponent(ProvenanceBar).exists()).toBe(false)
    expect(wrapper.text()).not.toContain('这一步讲的话太长')
  })

  // ⚠ 那时没有 ⑥ 区，表自己那行就是这一屏唯一的出处，删不得
  it('report 为 null 时出处由那张表自己印', () => {
    const wrapper = mount(ResultView, {
      props: { payload: FRAME, report: null },
    })

    expect(countOf(wrapper.text(), '台账 energy_log')).toBe(1)
  })

  // ⚠ 空区摆空态的话，老运行的弹窗上会凭空多出一片白块
  it('一个块都没有的区整个不渲染，不摆空态', () => {
    const wrapper = mount(ReportBlocks, { props: { blocks: [] } })

    expect(wrapper.findAll('[data-zone]')).toHaveLength(0)
    expect(wrapper.text()).toBe('')
  })
})

describe('有讲解时铺成六区', () => {
  const REPORT = reportOf([
    blockOf(),
    blockOf({ kind: 'bins', zone: 'charts', title: '空值率分布' }),
  ])

  it('锚点条按分区顺序摆，末位是完整数据', () => {
    const wrapper = mount(ResultView, {
      props: { payload: FRAME, report: REPORT },
    })
    const names = wrapper
      .findAll('.dt-ml-result__anchor')
      .map((node) => node.text())

    expect(names).toEqual(['这一步做了什么', '对比图', '完整数据'])
  })

  it('完整数据默认折叠，标题上写着点开有多少', () => {
    const wrapper = mount(ResultView, {
      props: { payload: FRAME, report: REPORT },
    })

    expect(wrapper.find('.dt-ml-result__toggle').text()).toContain(
      '完整数据（500 行 × 2 列）',
    )
    // ⚠ 折的只是那张表：图那一块在上面，收表不该把它一起收走
    expect(wrapper.text()).toContain('空值率分布')
    expect(wrapper.text()).not.toContain('中位')
    expect(wrapper.find('.dt-ml-result__scroll').exists()).toBe(false)
  })

  it('点开才渲染那张表，且套在内滚里', async () => {
    const wrapper = mount(ResultView, {
      props: { payload: FRAME, report: REPORT },
    })

    await wrapper.find('.dt-ml-result__toggle').trigger('click')

    expect(wrapper.find('.dt-ml-result__scroll').exists()).toBe(true)
    expect(wrapper.text()).toContain('中位')
  })

  // ⚠ ⑥ 区那行比表自己那句更全（请求区间与实际取到的区间分两段），两处一起印
  // 就是同一句灰字在同一个折叠区里说两遍。收起来的那一档看不见这个重复
  it('点开之后出处只印一行，不是同一句话说两遍', async () => {
    const wrapper = mount(ResultView, {
      props: { payload: FRAME, report: REPORT },
    })

    await wrapper.find('.dt-ml-result__toggle').trigger('click')

    expect(countOf(wrapper.text(), '台账 energy_log')).toBe(1)
    expect(wrapper.findComponent(ProvenanceBar).exists()).toBe(true)
  })

  // ⚠ 摘要被预算削过这件事后端一直在传，界面上一个字都没读过（规格 §1.4）
  it('摘要被字节预算削过时在顶上说一句', () => {
    const wrapper = mount(ResultView, {
      props: { payload: FRAME, report: REPORT, isPreviewTruncated: true },
    })
    const kinds = wrapper
      .findAllComponents(TruncationNotice)
      .map((notice) => notice.props('kind'))

    expect(kinds).toContain('budget')
  })

  it('降档丢掉的块照标题点名，不笼统说少了几块', () => {
    const wrapper = mount(ResultView, {
      props: {
        payload: FRAME,
        report: { ...REPORT, dropped: ['载荷热力'] },
      },
    })

    expect(wrapper.text()).toContain('载荷热力')
  })

  it('点锚点滚到那一区', async () => {
    const wrapper = mount(ResultView, {
      props: { payload: FRAME, report: REPORT },
      attachTo: document.body,
    })
    const target = wrapper.find('[data-zone="charts"]').element
    const calls: unknown[] = []
    target.scrollIntoView = () => calls.push('scrolled')

    await wrapper.findAll('.dt-ml-result__anchor')[1]?.trigger('click')

    expect(calls).toEqual(['scrolled'])
    wrapper.unmount()
  })

  // ⚠ `provenance.since` 是请求起点，实际起点只有时间轴块里那一个（D-7）
  it('时间轴块里的实际区间印在出处行上', () => {
    const wrapper = mount(ResultView, {
      props: {
        payload: FRAME,
        report: reportOf([
          blockOf({
            kind: 'axis',
            zone: 'charts',
            title: '时间覆盖',
            payload: { actual_since: '2026-08-12T03:00:00Z' },
          }),
        ]),
      },
    })

    expect(wrapper.findComponent(ProvenanceBar).text()).toContain('实际取到')
  })

  it('取数触顶在顶上说一次——那条表被折起来时也看得见', () => {
    const wrapper = mount(ResultView, {
      props: { payload: FRAME, report: REPORT },
    })

    expect(wrapper.findComponent(TruncationNotice).props('kind')).toBe('source')
  })
})

describe('多路输出摆成页签', () => {
  const PORTS = { train: FRAME_BODY, test: FRAME_BODY }
  const LABELS = { train: '训练集', test: '测试集' }
  const REPORT = reportOf([
    blockOf({ port: 'train', title: '训练段行数' }),
    blockOf({ port: 'test', title: '测试段行数' }),
  ])

  it('一次只渲染一路，不把同一份账印两遍', () => {
    const wrapper = mount(ResultView, {
      props: { payload: PORTS, labels: LABELS, report: REPORT },
    })

    expect(wrapper.findAll('.dt-segmented__item')).toHaveLength(2)
    expect(wrapper.text()).toContain('训练段行数')
    expect(wrapper.text()).not.toContain('测试段行数')
  })

  it('切到另一路就换成那一路的块', async () => {
    const wrapper = mount(ResultView, {
      props: { payload: PORTS, labels: LABELS, report: REPORT },
    })

    await wrapper.findAll('.dt-segmented__item')[1]?.trigger('click')

    expect(wrapper.text()).toContain('测试段行数')
    expect(wrapper.text()).not.toContain('训练段行数')
  })

  it('两路出处一字不差时补一句说明，不把同一句话印两遍', () => {
    const wrapper = mount(ResultView, {
      props: { payload: PORTS, labels: LABELS, report: REPORT },
    })

    expect(wrapper.findAll('.dt-ml-result__shared')).toHaveLength(1)
    expect(wrapper.findAllComponents(ProvenanceBar)).toHaveLength(1)
  })
})

describe('详情还没拉回时占住位置', () => {
  it('骨架高度按区固定，回来之后不跳版', () => {
    const wrapper = mount(ReportBlocks, { props: { pending: true } })
    const holds = wrapper
      .findAll('.dt-ml-blocks__hold')
      .map((node) => node.attributes('style'))

    expect(holds).toEqual(['height: 3rem;', 'height: 6rem;', 'height: 14rem;'])
  })
})

describe('出处那一行', () => {
  // ⚠ `provenance.since` 存的是**请求**起点，触顶时实际起点比它晚得多（D-7）
  it('触顶时请求区间与实际区间并排两行', () => {
    const text = mount(ProvenanceBar, {
      props: {
        tableCodes: ['energy_log'],
        since: '2026-01-01T00:00:00Z',
        until: null,
        actualSince: '2026-08-12T03:00:00Z',
        actualUntil: null,
        downloadUrl: '',
      },
    }).text()

    expect(text).toContain('请求')
    expect(text).toContain('实际取到')
    expect(text).toContain('2026/8/12')
  })

  it('没有实际区间时只印请求那一行，不编一个出来', () => {
    const text = mount(ProvenanceBar, {
      props: {
        tableCodes: ['energy_log'],
        since: '2026-01-01T00:00:00Z',
        until: null,
        actualSince: null,
        actualUntil: null,
        downloadUrl: '',
      },
    }).text()

    expect(text).not.toContain('实际取到')
    expect(text).toContain('energy_log')
  })

  // 出处不一定有台账：模型与评估那两路只有时间区间
  it('取不到台账来源时只印时间区间，不留一个空标签', () => {
    const bare = {
      tableCodes: [],
      since: '2026-01-01T00:00:00Z',
      until: null,
      actualUntil: null,
      downloadUrl: '',
    }
    const asked = mount(ProvenanceBar, {
      props: { ...bare, actualSince: null },
    })
    const truncated = mount(ProvenanceBar, {
      props: { ...bare, actualSince: '2026-08-12T03:00:00Z' },
    })

    expect(asked.text()).not.toContain('台账')
    expect(asked.text()).toContain('2026/1/1')
    expect(truncated.text()).not.toContain('台账')
    expect(truncated.text()).toContain('实际取到')
  })

  // ⚠ 屏上那份摘要有 200 行硬上限：想把处理好的数据拿走只能走这个链接
  it('留了全量结果时给一个原生下载链接', () => {
    const link = mount(ProvenanceBar, {
      props: {
        tableCodes: [],
        since: null,
        until: null,
        actualSince: null,
        actualUntil: null,
        downloadUrl: FRAME_URL,
      },
    }).find('a')

    expect(link.attributes('href')).toBe(FRAME_URL)
    // 交给浏览器直接下：几十 MB 的 CSV 拉回内存造 blob 是白付一遍内存
    expect(link.attributes('download')).toBe('')
    expect(link.text()).toBe('下载全量结果')
  })

  it('这次运行没留全量结果时不摆链接，不给一个点了没用的入口', () => {
    const wrapper = mount(ProvenanceBar, {
      props: {
        tableCodes: ['energy_log'],
        since: null,
        until: null,
        actualSince: null,
        actualUntil: null,
        downloadUrl: '',
      },
    })

    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('下载全量结果')
  })

  it('只有 exported_ports 里点了名的那一路才拿得到下载地址', () => {
    const shared = {
      payload: FRAME,
      report: reportOf([blockOf()]),
      runId: 'r1',
      nodeId: 'n1',
    }
    const kept = mount(ResultView, {
      props: { ...shared, exportedPorts: ['frame'] },
    })
    const gone = mount(ResultView, { props: { ...shared, exportedPorts: [] } })

    expect(kept.findComponent(ProvenanceBar).props('downloadUrl')).toContain(
      'port=frame',
    )
    expect(gone.findComponent(ProvenanceBar).props('downloadUrl')).toBe('')
  })
})

describe('认不出的那一路', () => {
  it('照实说明加折叠原文，不是一片空白', () => {
    const wrapper = mount(UnknownView, {
      props: {
        note: '本次运行的结果摘要已用满预算',
        raw: { kind: '将来某种' },
      },
    })

    expect(wrapper.text()).toContain('本次运行的结果摘要已用满预算')
    expect(wrapper.find('pre').text()).toContain('将来某种')
  })

  it('后端一句说明都没给时也给一句照实的话', () => {
    const wrapper = mount(UnknownView, { props: { note: '', raw: {} } })

    expect(wrapper.text()).toContain('认不出是什么形状')
  })
})

describe('结果弹窗', () => {
  const DETAIL: ModelingNodeRun = {
    node_id: 'n1',
    operator: 'ledger_source',
    alias: null,
    ordinal: 1,
    status: 'succeeded',
    duration_ms: 12,
    has_preview: true,
    error_text: null,
    preview: FRAME,
    is_preview_truncated: false,
    exported_ports: [],
    report: null,
    fitted: null,
  }

  function open(detail: ModelingNodeRun | null) {
    return mount(ResultDialog, {
      props: { detail, labels: {}, runId: 'r1', nodeId: 'n1' },
      attachTo: document.body,
    })
  }

  // ⚠ 占位高度按区固定：详情回来之后各区落在原处，不跳版
  it('详情还没拉回来时摆骨架，不是一片空白', () => {
    const wrapper = open(null)

    expect(document.body.querySelectorAll('.dt-ml-blocks__hold')).toHaveLength(
      3,
    )
    wrapper.unmount()
  })

  it('详情回来了就换成结果面', () => {
    const wrapper = open(DETAIL)

    expect(document.body.textContent).toContain('500 行 × 2 列')
    expect(document.body.querySelector('.dt-ml-blocks__hold')).toBeNull()
    wrapper.unmount()
  })

  // ⚠ FrameView 的两张表写死 52rem 最小宽，56rem 的弹窗里今天就在横向滚。
  // 断言的是传给 DtModal 的取值：happy-dom 解析不了 `min()`，行内样式会整条作废
  it('弹窗宽度给到 72rem，窄屏按视口收', () => {
    const wrapper = open(DETAIL)

    expect(wrapper.findComponent(DtModal).props('width')).toBe(
      'min(72rem, 92vw)',
    )
    wrapper.unmount()
  })
})
