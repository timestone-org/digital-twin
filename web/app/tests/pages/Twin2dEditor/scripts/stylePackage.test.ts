/**
 * @fileoverview 契约：样式包的导出与导入。
 *
 * ⚠ **往返一致**是这一支的要害：导出再导入，产出的样式与原样式逐字相同——不然
 * 「跨大屏搬样式」搬过去的是一份看着像、细节不一样的东西，而两边都不报错。
 * ⚠ 版本号比本版新的包一律拒绝并说明，不「尽力解析」。
 * ⚠ id 撞了默认**改名并存**：静默覆盖会把用户正在用的那份样式换掉，而这一步没有
 * 确认框也没有撤销提示。
 */
import {
  TWIN_2D_BUILTIN_NODE_STYLE_MAP,
  TWIN_2D_CONFIG_VERSION,
  TWIN_2D_EDGE_PRESETS,
  normalizeEdgeStyles,
  normalizeNodeStyles,
  normalizeTwin2dConfig,
} from '@dt/twin2d'
import type { Twin2dConfig, Twin2dEdgeStyle, Twin2dNodeStyle } from '@dt/twin2d'
import { describe, expect, it } from 'vitest'

import type { Twin2dIdFactory } from '@/pages/Twin2dEditor/scripts/nodeOps'
import {
  TWIN_2D_STYLE_PACKAGE_VERSION,
  exportTwin2dStylePackage,
  importTwin2dStyles,
  readTwin2dStylePackage,
  twin2dStylePackageText,
} from '@/pages/Twin2dEditor/scripts/stylePackage'
import type { Twin2dStylePackage } from '@/pages/Twin2dEditor/scripts/stylePackage'

/** 一个真存在的预置节点样式 id。 */
const BUILTIN_NODE = 'circuit-resistor'
/** 一个真存在的预置连线样式 id。 */
const BUILTIN_EDGE = 'steam'

/** 造 id 的桩：按调用次序发号且带上真实前缀。 */
function idSeq(): Twin2dIdFactory {
  let seq = 0
  return (prefix) => {
    seq += 1
    return `${prefix}-${seq}`
  }
}

/** 预置节点样式；取不到就让用例当场红。 */
function builtinNode(): Twin2dNodeStyle {
  const style = TWIN_2D_BUILTIN_NODE_STYLE_MAP.get(BUILTIN_NODE)
  if (style === undefined) throw new Error('预置节点样式不在')
  return style
}

/** 预置连线样式；取不到就让用例当场红。 */
function builtinEdge(): Twin2dEdgeStyle {
  const style = TWIN_2D_EDGE_PRESETS.find((item) => item.id === BUILTIN_EDGE)
  if (style === undefined) throw new Error('预置连线样式不在')
  return style
}

/** 一份自建节点样式。 */
function customNode(): Twin2dNodeStyle {
  const [style] = normalizeNodeStyles([
    {
      id: 'custom',
      name: '自建',
      size: { w: 40, h: 20 },
      prims: [{ id: 'p1', kind: 'txt', src: { kind: 'label' } }],
      ports: [{ id: 'A', name: '1' }],
      slots: [{ key: 'power', label: '功率', unit: 'kW' }],
    },
  ])
  if (style === undefined) throw new Error('自建样式没造出来')
  return style
}

/** 一份自建连线样式。 */
function customEdge(): Twin2dEdgeStyle {
  const [style] = normalizeEdgeStyles([{ id: 'my-wire', name: '我的线' }])
  if (style === undefined) throw new Error('自建连线样式没造出来')
  return style
}

function emptyConfig(): Twin2dConfig {
  return normalizeTwin2dConfig({})
}

function loadedConfig(): Twin2dConfig {
  return normalizeTwin2dConfig({
    styles: [
      { id: '别的', name: '不相干的一份' },
      { id: 'custom', name: '本地那份' },
    ],
    edgeStyles: [{ id: 'my-wire', name: '本地那条' }],
  })
}

/** 读一份包；读不出就让用例当场红。 */
function readOrThrow(text: string): Twin2dStylePackage {
  const read = readTwin2dStylePackage(text)
  if (!read.ok) throw new Error(read.reason)
  return read.pkg
}

describe('导出', () => {
  it('带上本版版本号与两张表', () => {
    const pkg = exportTwin2dStylePackage([customNode()], [customEdge()])

    expect(pkg.version).toBe(TWIN_2D_STYLE_PACKAGE_VERSION)
    expect(pkg.styles).toEqual([customNode()])
    expect(pkg.edgeStyles).toEqual([customEdge()])
  })

  it('版本号与文档版本钉在一起', () => {
    expect(TWIN_2D_STYLE_PACKAGE_VERSION).toBe(TWIN_2D_CONFIG_VERSION)
  })

  it('文本是一份能解析的 JSON', () => {
    const text = twin2dStylePackageText(
      exportTwin2dStylePackage([customNode()], []),
    )

    expect(text.startsWith('{')).toBe(true)
    expect(readOrThrow(text).styles).toEqual([customNode()])
  })
})

describe('读一份包', () => {
  it('不是 JSON 对象就说清楚', () => {
    const broken = readTwin2dStylePackage('{ 不是 JSON')
    const list = readTwin2dStylePackage('[]')

    expect(broken.ok).toBe(false)
    expect(list.ok).toBe(false)
  })

  it('没写版本号就拒绝', () => {
    const read = readTwin2dStylePackage(JSON.stringify({ styles: [] }))

    expect(read.ok).toBe(false)
    expect(read.ok ? '' : read.reason).toContain('版本号')
  })

  it('版本号不是正整数也拒绝', () => {
    const half = readTwin2dStylePackage(
      JSON.stringify({ version: 1.5, styles: [] }),
    )
    const zero = readTwin2dStylePackage(
      JSON.stringify({ version: 0, styles: [] }),
    )

    expect(half.ok).toBe(false)
    expect(zero.ok).toBe(false)
  })

  it('比本版新的包拒绝并把两个版本号都说出来', () => {
    const ahead = TWIN_2D_STYLE_PACKAGE_VERSION + 1
    const read = readTwin2dStylePackage(
      JSON.stringify({ version: ahead, styles: [] }),
    )

    expect(read.ok).toBe(false)
    expect(read.ok ? '' : read.reason).toContain(String(ahead))
    expect(read.ok ? '' : read.reason).toContain(
      String(TWIN_2D_STYLE_PACKAGE_VERSION),
    )
  })

  it('两张表一张都没有就拒绝：多半是拿错了文件', () => {
    const read = readTwin2dStylePackage(
      JSON.stringify({ version: TWIN_2D_STYLE_PACKAGE_VERSION, nodes: [] }),
    )

    expect(read.ok).toBe(false)
    expect(read.ok ? '' : read.reason).toContain('styles')
  })

  it('只带连线样式那一张表也读得下', () => {
    const pkg = readOrThrow(
      JSON.stringify({
        version: TWIN_2D_STYLE_PACKAGE_VERSION,
        edgeStyles: [customEdge()],
      }),
    )

    expect(pkg.styles).toEqual([])
    expect(pkg.edgeStyles).toEqual([customEdge()])
  })

  it('归一化没收下的条目要数出来', () => {
    const read = readTwin2dStylePackage(
      JSON.stringify({
        version: TWIN_2D_STYLE_PACKAGE_VERSION,
        styles: [{ name: '没有 id' }, { id: 'x' }, { id: 'x' }],
        edgeStyles: [{ id: 'y' }],
      }),
    )

    expect(read.ok ? read.dropped : -1).toBe(2)
    expect(read.ok ? read.pkg.styles.length : -1).toBe(1)
  })

  it('比本版旧的包照收，内容按本版归一化', () => {
    const read = readTwin2dStylePackage(
      JSON.stringify({ version: 1, styles: [{ id: 'x' }] }),
    )

    expect(read.ok).toBe(true)
    expect(read.ok ? read.pkg.version : 0).toBe(TWIN_2D_STYLE_PACKAGE_VERSION)
  })
})

describe('往返一致', () => {
  it('导出再导入，样式与原样式逐字相同', () => {
    const styles = [builtinNode(), customNode()]
    const edgeStyles = [builtinEdge(), customEdge()]
    const text = twin2dStylePackageText(
      exportTwin2dStylePackage(styles, edgeStyles),
    )
    const result = importTwin2dStyles(
      emptyConfig(),
      readOrThrow(text),
      'rename',
      idSeq(),
    )

    expect(result.config.styles).toEqual(styles)
    expect(result.config.edgeStyles).toEqual(edgeStyles)
    expect(result.styles.renamed).toEqual([])
  })

  it('导入之后再归一化不变形', () => {
    const text = twin2dStylePackageText(
      exportTwin2dStylePackage([builtinNode()], [builtinEdge()]),
    )
    const result = importTwin2dStyles(emptyConfig(), readOrThrow(text))

    expect(normalizeTwin2dConfig(result.config)).toEqual(result.config)
  })
})

describe('导入', () => {
  /** 一份与本地撞 id 的包。 */
  function clashing(): Twin2dStylePackage {
    return exportTwin2dStylePackage([customNode()], [customEdge()])
  }

  it('不撞就追加，并把落地的 id 报出来', () => {
    const pkg = exportTwin2dStylePackage([builtinNode()], [])
    const result = importTwin2dStyles(loadedConfig(), pkg, 'rename', idSeq())

    expect(result.config.styles.map((style) => style.id)).toEqual([
      '别的',
      'custom',
      BUILTIN_NODE,
    ])
    expect(result.styles.added).toEqual([BUILTIN_NODE])
    expect(result.styles.renamed).toEqual([])
  })

  it('撞了默认改名并存：新 id 以原 id 打头，本地那份纹丝不动', () => {
    const config = loadedConfig()
    const result = importTwin2dStyles(config, clashing(), 'rename', idSeq())

    expect(result.config.styles.map((style) => style.id)).toEqual([
      '别的',
      'custom',
      'custom-1',
    ])
    expect(result.config.styles.at(1)).toBe(config.styles.at(1))
    expect(result.styles.renamed).toEqual([{ from: 'custom', to: 'custom-1' }])
    expect(result.styles.added).toEqual(['custom-1'])
  })

  it('改名的那份除了 id 与包里的逐字相同', () => {
    const result = importTwin2dStyles(
      loadedConfig(),
      clashing(),
      'rename',
      idSeq(),
    )

    expect(result.config.styles.at(2)).toEqual({
      ...customNode(),
      id: 'custom-1',
    })
  })

  it('选覆盖就就地换掉，位置不变', () => {
    const result = importTwin2dStyles(
      loadedConfig(),
      clashing(),
      'overwrite',
      idSeq(),
    )

    expect(result.config.styles.map((style) => style.id)).toEqual([
      '别的',
      'custom',
    ])
    expect(result.config.styles.at(1)?.name).toBe('自建')
    expect(result.config.styles.at(0)?.name).toBe('不相干的一份')
    expect(result.styles.overwritten).toEqual(['custom'])
    expect(result.styles.added).toEqual([])
  })

  it('选跳过就把本地那份留着', () => {
    const config = loadedConfig()
    const result = importTwin2dStyles(config, clashing(), 'skip', idSeq())

    expect(result.config).toBe(config)
    expect(result.config.styles.at(1)?.name).toBe('本地那份')
    expect(result.styles.skipped).toEqual(['custom'])
    expect(result.edgeStyles.skipped).toEqual(['my-wire'])
  })

  it('连线样式走同一套三档', () => {
    const config = loadedConfig()
    const renamed = importTwin2dStyles(config, clashing(), 'rename', idSeq())
    const overwritten = importTwin2dStyles(config, clashing(), 'overwrite')

    // ⚠ 两张表共用同一台 id 工厂，节点样式那次改名先领了 1 号
    expect(renamed.config.edgeStyles.map((style) => style.id)).toEqual([
      'my-wire',
      'my-wire-2',
    ])
    expect(renamed.edgeStyles.renamed).toEqual([
      { from: 'my-wire', to: 'my-wire-2' },
    ])
    expect(overwritten.config.edgeStyles.at(0)?.name).toBe('我的线')
  })

  it('空包原样返回入参那份配置', () => {
    const config = loadedConfig()
    const result = importTwin2dStyles(config, exportTwin2dStylePackage([], []))

    expect(result.config).toBe(config)
    expect(result.styles.added).toEqual([])
  })
})
