/**
 * @fileoverview 契约：配置按路径读写是不可变的，路上类型对不上的中间层会被换掉
 * 而不是静默放弃——放弃的话用户改了一个字段却什么都没发生。
 */
import { describe, expect, it } from 'vitest'

import {
  appendConfigRow,
  readConfigAt,
  removeConfigRow,
  writeConfigAt,
} from '@/features/dashboard/configPath'

describe('按路径读', () => {
  it('读得到嵌套对象与数组里的值', () => {
    const config = { box: { rows: [{ label: '一' }, { label: '二' }] } }

    expect(readConfigAt(config, ['box', 'rows', 1, 'label'])).toBe('二')
  })

  it('路上任何一层缺席都给 undefined', () => {
    expect(readConfigAt({}, ['box', 'pad'])).toBeUndefined()
    expect(readConfigAt({ box: 7 }, ['box', 'pad'])).toBeUndefined()
    expect(readConfigAt({ rows: {} }, ['rows', 0])).toBeUndefined()
  })

  it('空路径读出整份配置', () => {
    const config = { a: 1 }

    expect(readConfigAt(config, [])).toBe(config)
  })
})

describe('按路径写', () => {
  it('沿路径逐层复制，原对象一字未动', () => {
    const config = { box: { pad: 4, gap: 2 } }
    const next = writeConfigAt(config, ['box', 'pad'], 12)

    expect(next).toEqual({ box: { pad: 12, gap: 2 } })
    expect(config).toEqual({ box: { pad: 4, gap: 2 } })
    expect(next).not.toBe(config)
  })

  it('中间层类型不对时换成新容器，而不是放弃这次写入', () => {
    expect(writeConfigAt({ box: 'oops' }, ['box', 'pad'], 3)).toEqual({
      box: { pad: 3 },
    })
  })

  it('数字段落写进数组，数组不存在就新建', () => {
    expect(writeConfigAt({}, ['rows', 0, 'label'], '一')).toEqual({
      rows: [{ label: '一' }],
    })
  })

  it('空路径写一个对象即整体替换，写非对象则保持原样', () => {
    const config = { a: 1 }

    expect(writeConfigAt(config, [], { b: 2 })).toEqual({ b: 2 })
    expect(writeConfigAt(config, [], 7)).toBe(config)
  })
})

describe('数组行的增删', () => {
  it('追加一行', () => {
    expect(appendConfigRow({ rows: [{ a: 1 }] }, ['rows'], { a: 2 })).toEqual({
      rows: [{ a: 1 }, { a: 2 }],
    })
  })

  it('路径上没有数组时从空表开始追加', () => {
    expect(appendConfigRow({}, ['rows'], { a: 1 })).toEqual({
      rows: [{ a: 1 }],
    })
  })

  it('删中间一行，其余整体前移而不是留个洞', () => {
    expect(
      removeConfigRow({ rows: [{ a: 1 }, { a: 2 }, { a: 3 }] }, ['rows'], 1),
    ).toEqual({ rows: [{ a: 1 }, { a: 3 }] })
  })

  it('路径上不是数组时原样返回', () => {
    const config = { rows: 7 }

    expect(removeConfigRow(config, ['rows'], 0)).toBe(config)
  })
})
