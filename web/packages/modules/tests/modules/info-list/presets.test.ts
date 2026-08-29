/**
 * @fileoverview 守八套外观预设的数据面：id 集合、只写清单里有的键、枚举取值都在
 * 该字段的选项里、每套都把每一个簇写全且子键顺序与字段缺省逐字相同、颜色一律
 * `var(--…)`、内容键一个都不写。
 *
 * ⚠ 这几类错法点了按钮什么都不会发生，而 typecheck、lint、build 全绿：
 * 键写错就是「配了不生效」；少写一个簇，上一套留在配置里的那一整块原样残留，
 * 而点亮判定做的是子集比较、照样把按钮点亮。
 */
import type { ConfigField } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import manifest from '../../../src/modules/info-list/manifest'
import { INFO_LIST_PRESETS } from '../../../src/modules/info-list/presets'

const SCHEMA = manifest.configSchema
const TOP_KEYS = new Set(SCHEMA.map((field) => field.key))
const OBJECT_FIELDS = SCHEMA.filter((field) => field.type === 'object')

/** 预设换的是观感，这三个内容键写了就会抹掉用户配好的行。 */
const CONTENT_KEYS = manifest.contentKeys ?? []

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function optionValues(field: ConfigField): unknown[] {
  return (field.options ?? []).map((option) => option.value)
}

/** 一层记录里落在枚举字段上、却不在该字段选项里的取值。 */
function strayEnums(
  fields: readonly ConfigField[],
  record: Record<string, unknown>,
  at: string,
): string[] {
  const found: string[] = []
  for (const [key, value] of Object.entries(record)) {
    const field = fields.find((item) => item.key === key)
    if (field === undefined) continue
    if (field.type === 'enum' && !optionValues(field).includes(value)) {
      found.push(`${at}.${key}=${String(value)}`)
    }
    found.push(...strayNested(field, value, `${at}.${key}`))
  }
  return found
}

function strayNested(field: ConfigField, value: unknown, at: string): string[] {
  if (field.fields !== undefined) {
    return strayEnums(field.fields, asRecord(value), at)
  }
  const rows = field.itemSchema
  if (rows === undefined) return []
  return asArray(value).flatMap((row, index) =>
    strayEnums(rows, asRecord(row), `${at}[${index}]`),
  )
}

/** 深走一份配置，收集每一处颜色取值。 */
function colorsIn(value: unknown, at: string): { at: string; color: string }[] {
  if (Array.isArray(value)) {
    return value.flatMap((row, index) => colorsIn(row, `${at}[${index}]`))
  }
  const record = asRecord(value)
  return Object.entries(record).flatMap(([key, child]) =>
    typeof child === 'string' && /color$/i.test(key)
      ? [{ at: `${at}.${key}`, color: child }]
      : colorsIn(child, `${at}.${key}`),
  )
}

describe('信息列表的八套预设', () => {
  it('id 集合恰是写死的这八个，顺序即面板上的排布', () => {
    expect(INFO_LIST_PRESETS.map((preset) => preset.id)).toEqual([
      'row-list',
      'three-col',
      'target-badge-list',
      'source-card',
      'terminal-card',
      'vessel-card',
      'work-order',
      'alarm-rows',
    ])
  })

  it('清单挂的就是这一份，不是另抄的一份', () => {
    expect(manifest.configPresets).toBe(INFO_LIST_PRESETS)
  })

  it('每套都有按钮文案与一句话说明', () => {
    const thin = INFO_LIST_PRESETS.filter(
      (preset) => preset.label.trim() === '' || (preset.hint ?? '') === '',
    ).map((preset) => preset.id)

    expect(thin).toEqual([])
  })
})

describe('预设写的键', () => {
  it('每个键都在清单的顶层键集合里', () => {
    const unknown = INFO_LIST_PRESETS.flatMap((preset) =>
      Object.keys(preset.config)
        .filter((key) => !TOP_KEYS.has(key))
        .map((key) => `${preset.id}.${key}`),
    )

    expect(unknown).toEqual([])
  })

  it('八套写的是同一组观感键——少一个键就会让上一套的那个取值原样残留', () => {
    const shapes = INFO_LIST_PRESETS.map((preset) =>
      Object.keys(preset.config)
        .filter((key) => key !== 'rules')
        .sort()
        .join(','),
    )

    expect(new Set(shapes).size).toBe(1)
    expect(
      Object.keys(INFO_LIST_PRESETS[0]?.config ?? {}).filter(
        (key) => key !== 'rules',
      ),
    ).toHaveLength(31)
  })

  /**
   * `rules` 是内容键，所以它被排除在上面那条「同一组键」之外，代价要说清：
   * 从带出厂规则的那两套换成别的一套，那组规则**原样留着**（别的套不写这个键）。
   * 这是刻意的取舍——反过来让每一套都写 `rules: []` 的话，任何一次换观感都会把
   * 用户自己配的阈值静默清空，那是数据丢失，比留一组看得见的颜色严重得多
   * （CARD_STYLE_LIBRARY_DESIGN §1.3）。
   */
  it('只有这两套带出厂规则，其余六套一个字都不碰它', () => {
    const carriers = INFO_LIST_PRESETS.filter(
      (preset) => 'rules' in preset.config,
    ).map((preset) => preset.id)

    expect(carriers).toEqual(['vessel-card', 'work-order'])
  })

  // `rules` 也是内容键，但它有出厂规则那一条例外，由上面那条用例单独管
  it('内容键一个都不写：预设换的是观感，不是把用户配好的行抹掉', () => {
    const wiped = INFO_LIST_PRESETS.flatMap((preset) =>
      CONTENT_KEYS.filter((key) => key !== 'rules' && key in preset.config).map(
        (key) => `${preset.id}.${key}`,
      ),
    )

    expect(wiped).toEqual([])
    // 反过来锁住这几个键真的在清单里，免得改名之后这条断言变成空转
    expect(CONTENT_KEYS.filter((key) => TOP_KEYS.has(key))).toEqual(
      CONTENT_KEYS,
    )
  })
})

describe('预设写的取值', () => {
  it('每个枚举取值都在该字段的选项里，簇内与行内也一样', () => {
    const stray = INFO_LIST_PRESETS.flatMap((preset) =>
      strayEnums(SCHEMA, preset.config, preset.id),
    )

    expect(stray).toEqual([])
  })

  it('扫描器认得出真写错了档位的那一处', () => {
    expect(strayEnums(SCHEMA, { rowShell: '描边卡' }, 'demo')).toEqual([
      'demo.rowShell=描边卡',
    ])
    expect(strayEnums(SCHEMA, { badge: { kind: 'devices' } }, 'demo')).toEqual([
      'demo.badge.kind=devices',
    ])
  })

  it('每套都把每一个簇写全，子键顺序与该字段缺省逐字相同', () => {
    const drift = INFO_LIST_PRESETS.flatMap((preset) =>
      OBJECT_FIELDS.map((field) => ({
        at: `${preset.id}.${field.key}`,
        wrote: Object.keys(asRecord(preset.config[field.key])).join(),
        want: Object.keys(asRecord(field.default)).join(),
      })),
    ).filter((row) => row.wrote !== row.want)

    expect(OBJECT_FIELDS.length).toBeGreaterThan(0)
    expect(drift).toEqual([])
  })

  it('行编排每一段都写全四个段位，最多三段', () => {
    const wanted = ['left', 'left2', 'right', 'right2'].join()
    const drift = INFO_LIST_PRESETS.flatMap((preset) => {
      const lines = asArray(preset.config.rowLines)
      return [
        ...(lines.length > 3 ? [`${preset.id}.rowLines 超过三段`] : []),
        ...lines
          .map((line, index) => ({
            at: `${preset.id}.rowLines[${index}]`,
            wrote: Object.keys(asRecord(line)).join(),
          }))
          .filter((row) => row.wrote !== wanted)
          .map((row) => `${row.at}=${row.wrote}`),
      ]
    })

    expect(drift).toEqual([])
  })

  it('扩展指标每一格都写全三个键，最多三格', () => {
    const wanted = ['label', 'unit', 'precision'].join()
    const drift = INFO_LIST_PRESETS.flatMap((preset) => {
      const cells = asArray(preset.config.extras)
      return [
        ...(cells.length > 3 ? [`${preset.id}.extras 超过三格`] : []),
        ...cells
          .filter((cell) => Object.keys(asRecord(cell)).join() !== wanted)
          .map(
            (cell) =>
              `${preset.id}.extras:${Object.keys(asRecord(cell)).join()}`,
          ),
      ]
    })

    expect(drift).toEqual([])
  })

  it('颜色一律 var(--…) 引用：算出来的色值换肤时不跟着走', () => {
    const literal = INFO_LIST_PRESETS.flatMap((preset) =>
      colorsIn(preset.config, preset.id),
    ).filter((entry) => entry.color !== '' && !entry.color.startsWith('var(--'))

    expect(literal).toEqual([])
  })

  it('扫描器真的走到了规则表里那一层颜色', () => {
    const found = INFO_LIST_PRESETS.flatMap((preset) =>
      colorsIn(preset.config, preset.id),
    ).map((entry) => entry.at)

    expect(found).toContain('vessel-card.rules[0].color')
    expect(found).toContain('work-order.rules[2].color')
    expect(found).toContain('row-list.valueColor')
    expect(found).toContain('row-list.meter.color')
  })
})

describe('两套按值分color的预设', () => {
  it('水温梯度四档高危在前——顺序反了会让「两档都超」判成偏热', () => {
    const rules = asArray(
      INFO_LIST_PRESETS.find((preset) => preset.id === 'vessel-card')?.config
        .rules,
    ).map((rule) => asRecord(rule))

    expect(rules.map((rule) => [rule.op, rule.value, rule.value2])).toEqual([
      ['gt', 55, undefined],
      ['gt', 45, undefined],
      ['lt', 30, undefined],
      ['between', 30, 45],
    ])
    expect(rules.map((rule) => rule.level)).toEqual([
      'danger',
      'warning',
      'info',
      'normal',
    ])
    expect(rules.map((rule) => rule.color)).toEqual([
      'var(--state-danger)',
      'var(--state-warning)',
      'var(--state-info)',
      'var(--accent-secondary)',
    ])
  })

  it('工单三档状态的严重度全填正常，只借规则表拿文案与颜色', () => {
    const preset = INFO_LIST_PRESETS.find(
      (item) => item.id === 'work-order',
    )?.config
    const rules = asArray(preset?.rules).map((rule) => asRecord(rule))

    expect(rules.map((rule) => [rule.op, rule.value, rule.label])).toEqual([
      ['eq', 0, '待执行'],
      ['eq', 1, '执行中'],
      ['eq', 2, '已完成'],
    ])
    // ⚠ 填高严重度会让每一条待执行工单都把整行点成告警态
    expect(rules.map((rule) => rule.level)).toEqual([
      'normal',
      'normal',
      'normal',
    ])
    expect(preset?.alarmOn).toBe('sub')
    expect(preset?.badge).toEqual({ kind: 'rule', style: 'solid' })
  })
})

describe('八套预设各自的身份取值', () => {
  it('每套的行外壳、分组、滚动秒数与时刻来源都是它自己那一套', () => {
    const shapes = INFO_LIST_PRESETS.map((preset) => [
      preset.id,
      preset.config.rowShell,
      preset.config.grouping,
      preset.config.scrollSpeed,
      preset.config.timeSource,
    ])

    expect(shapes).toEqual([
      ['row-list', 'divider', 'none', 3, 'sample'],
      ['three-col', 'divider', 'none', 3, 'sample'],
      ['target-badge-list', 'divider', 'none', 3, 'sample'],
      ['source-card', 'accent', 'none', 5, 'sample'],
      ['terminal-card', 'card', 'tabs', 4, 'sample'],
      ['vessel-card', 'card', 'section', 4, 'sample'],
      ['work-order', 'edge', 'none', 3, 'bound'],
      ['alarm-rows', 'edge', 'none', 3, 'alarmSince'],
    ])
  })

  it('只有活动告警那一套筛掉不告警的行并按严重度排序', () => {
    const filters = INFO_LIST_PRESETS.map((preset) => [
      preset.config.rowFilter,
      preset.config.rowSort,
    ])

    expect(filters.filter((row) => row[0] !== 'all')).toEqual([
      ['alarm', 'severity'],
    ])
  })

  it('三列表是唯一走三列排版并摆出表头的那一套', () => {
    const columns = INFO_LIST_PRESETS.filter(
      (preset) => preset.config.rowLayout === 'columns',
    )

    expect(columns.map((preset) => preset.id)).toEqual(['three-col'])
    expect(columns[0]?.config.columnHeader).toEqual({
      show: true,
      name: '名称',
      value: '数值',
      unit: '单位',
    })
    expect(columns[0]?.config.unitPlace).toBe('column')
  })

  it('两条同构进度条只有容器卡片那一套用得上', () => {
    const twoBars = INFO_LIST_PRESETS.filter(
      (preset) => asRecord(preset.config.meter).source2 !== 'none',
    )

    expect(twoBars.map((preset) => preset.id)).toEqual(['vessel-card'])
    expect(twoBars[0]?.config.meter).toMatchObject({
      source: 'range',
      label: '占比',
      dot: true,
      source2: 'aux2',
      label2: '液位',
    })
  })

  it('扩展指标行只有能源源卡片那一套摆得出来，三格逐字对上参考观感', () => {
    const withExtras = INFO_LIST_PRESETS.filter(
      (preset) => asArray(preset.config.extras).length > 0,
    )

    expect(withExtras.map((preset) => preset.id)).toEqual(['source-card'])
    expect(withExtras[0]?.config.extras).toEqual([
      { label: '功率', unit: 'kW', precision: 1 },
      { label: '温度', unit: '℃', precision: 1 },
      { label: '流量', unit: 'm³/h', precision: 1 },
    ])
    expect(asRecord(withExtras[0]?.config.rowShape).extras).toBe(true)
  })
})
