/**
 * @fileoverview 守「两份格式化表不许漂移」：`@dt/twin2d/src/format.ts` 是
 * `@dt/modules/src/shared/format.ts` 的第二份副本（twin2d 不许依赖 modules，方向反了），
 * 这里对同一张输入表逐项断言两边**行为**一致，并把 locale 钉在 `en-US`（§11.3）。
 */
import { describe, expect, it } from 'vitest'

import * as source from '../../../packages/modules/src/shared/format'
import * as copy from '../../../packages/twin2d/src/format'

/**
 * ⚠ 这两条 import 走文件相对路径而不是各自的包桶：契约要钉的是这两个**文件**的行为，
 * 走桶的话「桶转出了另一份实现」这种漂移反而照样绿。何况 `@dt/modules` 的桶根本不转出
 * format，而 `app` 也没有 `@dt/twin2d` 这条依赖。
 */

// 无数据占位符，字面量写死在这里，两份副本一起改字形也照样红
const NO_DATA = '—'

/** 两份副本重叠的那部分公开面；`formatSlotValue` / `toNumOrNull` 不在其中。 */
interface FormatApi {
  readonly NO_DATA: string
  readonly isPresent: (raw: unknown) => boolean
  readonly fmtFixed: (raw: unknown, digits?: number) => string
  readonly fmtNumber: (raw: unknown, precision?: number) => string
  readonly fmtTrim: (raw: unknown, max?: number) => string
  readonly fmtKwh: (raw: unknown, precision?: number) => string
  readonly fmtDecimal: (
    raw: unknown,
    digits?: number,
    grouping?: boolean,
  ) => string
  readonly fmtClock: (epochMs: unknown) => string
}

const SOURCE: FormatApi = source
const COPY: FormatApi = copy

/** 互相可赋值才算 true；单向兼容（一边把类型放宽）会落成 false。 */
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

type AnyFn = (...args: never[]) => unknown

/**
 * ⚠ 光比函数类型不够：TS 认为少一个形参的函数可以赋给多一个形参的，于是
 * `(raw) => string` 与 `(raw, max?) => string` 互相可赋值、漏判成对齐。
 * 参数元组要单独比一遍，`Mutual` 那一层则负责守住 `isPresent` 的类型谓词。
 */
type SameSignature<A extends AnyFn, B extends AnyFn> =
  Mutual<A, B> extends true ? Mutual<Parameters<A>, Parameters<B>> : false

/**
 * 签名对齐表：任何一个函数的参数/返回类型漂了，这里的 `true` 就赋不进去，
 * typecheck 先于测试红。键集合同时是下面「导出面」用例的名单。
 */
const SIGNATURES: {
  readonly NO_DATA: Mutual<typeof copy.NO_DATA, typeof source.NO_DATA>
  readonly isPresent: SameSignature<
    typeof copy.isPresent,
    typeof source.isPresent
  >
  readonly fmtFixed: SameSignature<typeof copy.fmtFixed, typeof source.fmtFixed>
  readonly fmtNumber: SameSignature<
    typeof copy.fmtNumber,
    typeof source.fmtNumber
  >
  readonly fmtTrim: SameSignature<typeof copy.fmtTrim, typeof source.fmtTrim>
  readonly fmtKwh: SameSignature<typeof copy.fmtKwh, typeof source.fmtKwh>
  readonly fmtDecimal: SameSignature<
    typeof copy.fmtDecimal,
    typeof source.fmtDecimal
  >
  readonly fmtClock: SameSignature<typeof copy.fmtClock, typeof source.fmtClock>
} = {
  NO_DATA: true,
  isPresent: true,
  fmtFixed: true,
  fmtNumber: true,
  fmtTrim: true,
  fmtKwh: true,
  fmtDecimal: true,
  fmtClock: true,
}

const PARITY_NAMES = Object.keys(SIGNATURES)
// 真源独有：twin2d 侧没有「取有限数否则 null」的调用点
const SOURCE_ONLY = ['toNumOrNull']
// 副本独有：按槽位 precision/unit/enumMap 出显示串，真源里没有槽位这个概念
const COPY_ONLY = ['formatSlotValue']

/** 一格输入：同一次调用喂给两边，各自都要等于 `shows`。 */
interface Case {
  readonly title: string
  readonly run: (api: FormatApi) => string
  readonly shows: string
}

/**
 * 把一张表逐格跑成独立用例——漂了要能报出是哪一格，而不是「两张表不相等」。
 * @param cases 输入表
 */
function itParity(cases: readonly Case[]): void {
  it.each(cases)('$title', ({ run, shows }: Case) => {
    expect(run(SOURCE)).toBe(shows)
    expect(run(COPY)).toBe(shows)
  })
}

/** 一个格式化函数在缺值表上的取值方式。 */
interface Formatter {
  readonly name: string
  readonly call: (api: FormatApi, raw: unknown) => string
}

const FORMATTERS: readonly Formatter[] = [
  { name: 'fmtFixed', call: (api, raw) => api.fmtFixed(raw, 2) },
  { name: 'fmtNumber', call: (api, raw) => api.fmtNumber(raw) },
  { name: 'fmtTrim', call: (api, raw) => api.fmtTrim(raw) },
  { name: 'fmtKwh', call: (api, raw) => api.fmtKwh(raw) },
  { name: 'fmtDecimal', call: (api, raw) => api.fmtDecimal(raw) },
  { name: 'fmtClock', call: (api, raw) => api.fmtClock(raw) },
]

const MISSING: readonly (readonly [string, unknown])[] = [
  ['null', null],
  ['undefined', undefined],
  ["''", ''],
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
  ['-Infinity', Number.NEGATIVE_INFINITY],
  ['true', true],
  ['{}', {}],
]

const MISSING_CASES: readonly Case[] = FORMATTERS.flatMap((formatter) =>
  MISSING.map(([label, raw]) => ({
    title: `${formatter.name}(${label}) 落占位符而不是伪造出一个 0`,
    run: (api: FormatApi) => formatter.call(api, raw),
    shows: NO_DATA,
  })),
)

const PRESENT_CASES: readonly Case[] = [
  ...MISSING.map(([label, raw]) => ({
    title: `isPresent(${label}) 判否`,
    run: (api: FormatApi) => String(api.isPresent(raw)),
    shows: 'false',
  })),
  {
    title: 'isPresent(0) 判真——真实的 0 是一个读数，不是缺值',
    run: (api) => String(api.isPresent(0)),
    shows: 'true',
  },
  {
    title: 'isPresent(-0) 判真',
    run: (api) => String(api.isPresent(-0)),
    shows: 'true',
  },
]

describe('twin2d 的 format 副本与 shared/format 真源：导出面', () => {
  it('真源的每个导出要么在副本里同名同签名，要么记在「不复制」名单上', () => {
    expect(Object.keys(source).sort()).toEqual(
      [...PARITY_NAMES, ...SOURCE_ONLY].sort(),
    )
  })

  it('副本没有多长出一个真源里不存在的格式化函数', () => {
    expect(Object.keys(copy).sort()).toEqual(
      [...PARITY_NAMES, ...COPY_ONLY].sort(),
    )
  })

  it('占位符两边同为「—」', () => {
    expect(SOURCE.NO_DATA).toBe(NO_DATA)
    expect(COPY.NO_DATA).toBe(NO_DATA)
  })
})

describe('缺值口径', () => {
  itParity(MISSING_CASES)
  itParity(PRESENT_CASES)
})

describe('fmtTrim：抹掉尾随零、不上千分位', () => {
  itParity([
    {
      title: 'fmtTrim(63.40) 抹掉尾随零给 63.4',
      run: (api) => api.fmtTrim(63.4),
      shows: '63.4',
    },
    {
      title: 'fmtTrim(-0) 归一成 0，大屏上不许出现「-0」',
      run: (api) => api.fmtTrim(-0),
      shows: '0',
    },
    {
      title: 'fmtTrim(1234.5678, 2) 四舍五入到两位且不插千分位',
      run: (api) => api.fmtTrim(1234.5678, 2),
      shows: '1234.57',
    },
    {
      title: 'fmtTrim(1234.5678, 0) 收成整数',
      run: (api) => api.fmtTrim(1234.5678, 0),
      shows: '1235',
    },
    {
      title: 'fmtTrim 的位数 -5 钳到 0',
      run: (api) => api.fmtTrim(1234.5678, -5),
      shows: '1235',
    },
    {
      title: 'fmtTrim 的位数 200 钳到 100 而不是抛 RangeError',
      run: (api) => api.fmtTrim(1234.5678, 200),
      shows: '1234.5678',
    },
    {
      title: 'fmtTrim 的位数 NaN 回落到缺省的 2',
      run: (api) => api.fmtTrim(1234.5678, Number.NaN),
      shows: '1234.57',
    },
  ])
})

describe('fmtKwh：取整后判档', () => {
  itParity([
    {
      title: 'fmtKwh(999.6) 取整到 1000 故进压缩档给 1k',
      run: (api) => api.fmtKwh(999.6),
      shows: '1k',
    },
    {
      title: 'fmtKwh(999.4) 取整仍是 999 故留在整数档',
      run: (api) => api.fmtKwh(999.4),
      shows: '999',
    },
    {
      title: 'fmtKwh(1000) 与 999.6 同显，一屏上不并排出现两种写法',
      run: (api) => api.fmtKwh(1000),
      shows: '1k',
    },
    {
      title: 'fmtKwh(-1234.5) 负号在前、量级照绝对值算',
      run: (api) => api.fmtKwh(-1234.5),
      shows: '-1.23k',
    },
    {
      title: 'fmtKwh(-999.6) 负数同样按取整后判档',
      run: (api) => api.fmtKwh(-999.6),
      shows: '-1k',
    },
    {
      title: 'fmtKwh(-0) 不带负号',
      run: (api) => api.fmtKwh(-0),
      shows: '0',
    },
    {
      title: 'fmtKwh(12345, 0) 压缩档的位数由参数定',
      run: (api) => api.fmtKwh(12345, 0),
      shows: '12k',
    },
    {
      title: 'fmtKwh(999999) 只有 k 一档，不再往上进位',
      run: (api) => api.fmtKwh(999999),
      shows: '1000k',
    },
  ])
})

describe('fmtFixed 与 fmtDecimal：补零的两档', () => {
  itParity([
    {
      title: 'fmtFixed(63.4, 2) 补零到 63.40',
      run: (api) => api.fmtFixed(63.4, 2),
      shows: '63.40',
    },
    {
      title: 'fmtFixed 的缺省位数是 0',
      run: (api) => api.fmtFixed(63.4),
      shows: '63',
    },
    {
      title: 'fmtFixed 的位数 -5 钳到 0',
      run: (api) => api.fmtFixed(63.4, -5),
      shows: '63',
    },
    {
      title: 'fmtFixed 的位数 200 钳到 100 而不是抛 RangeError',
      run: (api) => String(api.fmtFixed(63.4, 200).length),
      shows: '103',
    },
    {
      title: 'fmtFixed 的位数 NaN 回落到缺省的 0',
      run: (api) => api.fmtFixed(63.4, Number.NaN),
      shows: '63',
    },
    {
      title: 'fmtFixed(-0.004, 2) 保留负号——这一档不做 -0 归一',
      run: (api) => api.fmtFixed(-0.004, 2),
      shows: '-0.00',
    },
    {
      title: 'fmtFixed(1234.5, 1) 不插千分位',
      run: (api) => api.fmtFixed(1234.5, 1),
      shows: '1234.5',
    },
    {
      title: 'fmtDecimal(63.4, 2) 补零到 63.40，与 fmtNumber 的抹零分工相反',
      run: (api) => api.fmtDecimal(63.4, 2),
      shows: '63.40',
    },
    {
      title: 'fmtDecimal 的缺省位数是 1',
      run: (api) => api.fmtDecimal(63.4),
      shows: '63.4',
    },
    {
      title: 'fmtDecimal(-0, 1) 归一成 0.0',
      run: (api) => api.fmtDecimal(-0, 1),
      shows: '0.0',
    },
    {
      title: 'fmtDecimal 的位数 -5 钳到 0',
      run: (api) => api.fmtDecimal(1234.56, -5),
      shows: '1235',
    },
    {
      title: 'fmtDecimal 的位数 200 钳到 100 而不是抛 RangeError',
      run: (api) => String(api.fmtDecimal(1234.56, 200).length),
      shows: '105',
    },
    {
      title: 'fmtDecimal 的位数 NaN 回落到缺省的 1',
      run: (api) => api.fmtDecimal(1234.56, Number.NaN),
      shows: '1234.6',
    },
    {
      title: 'fmtDecimal 的 grouping 缺省关闭',
      run: (api) => api.fmtDecimal(1234.56, 1),
      shows: '1234.6',
    },
  ])
})

describe('fmtNumber：最多几位、尾随零会被抹掉', () => {
  itParity([
    {
      title: 'fmtNumber(63.40, 2) 抹掉尾随零给 63.4',
      run: (api) => api.fmtNumber(63.4, 2),
      shows: '63.4',
    },
    {
      title: 'fmtNumber 的位数 0 先四舍五入到整数',
      run: (api) => api.fmtNumber(1234.56, 0),
      shows: '1,235',
    },
    {
      title: 'fmtNumber 的位数 -5 走整数分支',
      run: (api) => api.fmtNumber(1234.56, -5),
      shows: '1,235',
    },
    {
      title: 'fmtNumber 的位数 NaN 回落到缺省的 2',
      run: (api) => api.fmtNumber(1234.5, Number.NaN),
      shows: '1,234.5',
    },
    {
      title: 'fmtNumber(-0) 归一成 0',
      run: (api) => api.fmtNumber(-0),
      shows: '0',
    },
  ])
})

describe("locale 钉死在 'en-US'", () => {
  itParity([
    {
      title: 'fmtNumber 的千分位是英文逗号、小数点是点',
      run: (api) => api.fmtNumber(1234567.891),
      shows: '1,234,567.89',
    },
    {
      title: 'fmtDecimal 开 grouping 时同样是英文逗号',
      run: (api) => api.fmtDecimal(1234.56, 1, true),
      shows: '1,234.6',
    },
    {
      title: 'fmtTrim 不分组，长数字里一个逗号都不许出现',
      run: (api) => api.fmtTrim(1234567.891, 2),
      shows: '1234567.89',
    },
    {
      title: 'fmtKwh 经 fmtTrim 出数，压缩档同样不带分组',
      run: (api) => api.fmtKwh(1234567.891),
      shows: '1234.57k',
    },
  ])
})

// 用本地时构造，才不会因为跑测的机器时区不同而漂
const LOCAL_CLOCK_AT = new Date(2026, 0, 2, 3, 4, 5).getTime()

describe('fmtClock：本地时到秒', () => {
  itParity([
    {
      title: 'fmtClock 出 HH:mm:ss 且时分秒都补两位',
      run: (api) => api.fmtClock(LOCAL_CLOCK_AT),
      shows: '03:04:05',
    },
    {
      title: 'fmtClock(1e20) 是有限数但落在 Date 范围外，同样给占位符',
      run: (api) => api.fmtClock(1e20),
      shows: NO_DATA,
    },
  ])
})
