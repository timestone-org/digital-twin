/**
 * @fileoverview 内置部件的四道闸。它们查的都是**加一个部件时漏了不会报错**的事——
 * 表现全是「属性面板上那一格调了没反应」或「那一格永远不出现」，而 typecheck、
 * lint、build 一路全绿。
 *
 * ⚠ 自检本体在 `cardParts/audit.ts`，那边逐条证明过它们**逮得住**；这里只断言
 * 内置的这几个是干净的。两处缺一不可：只有断言没有反证，`toEqual([])` 就是空转。
 */
import { isIconName } from '@dt/ui'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  danglingPartConditions,
  duplicateFieldKeys,
  fieldsWithoutKindCondition,
  incompleteParts,
  strayPartSlots,
} from '../../../src/cardParts/audit'
import { CARD_PART_KIND_KEY } from '../../../src/cardParts/define'
import {
  __resetCardParts,
  missingCardParts,
} from '../../../src/cardParts/registry'
import { CARD_SLOT_KEYS } from '../../../src/cardParts/types'
import manifest from '../../../src/modules/data-card/manifest'
import {
  BUILTIN_CARD_PARTS,
  registerBuiltinCardParts,
} from '../../../src/modules/data-card/parts'

/** 部件表那个数组字段的行字段，也就是并集之后的样子。 */
function itemSchema() {
  return (
    manifest.configSchema.find(
      (field) =>
        field.type === 'array' &&
        field.itemSchema !== undefined &&
        field.key === 'parts',
    )?.itemSchema ?? []
  )
}

beforeAll(registerBuiltinCardParts)
afterEach(registerBuiltinCardParts)

describe('内置部件本身', () => {
  it('扫描本身没有空转——真有部件可查', () => {
    expect(BUILTIN_CARD_PARTS.length).toBeGreaterThan(0)
  })

  it('必填项都齐：缺 icon 菜单里没图标，缺 hint 用户与模型都猜不出用途', () => {
    expect(incompleteParts(BUILTIN_CARD_PARTS)).toEqual([])
  })

  // ⚠ 图标名写错不报错也不渲染——「加部件」菜单里那一格就是空的
  it('图标名都在 DtIcon 注册表里', () => {
    const stray = BUILTIN_CARD_PARTS.filter(
      (part) => !isIconName(part.icon),
    ).map((part) => `${part.kind}.${part.icon}`)

    expect(stray).toEqual([])
  })

  it('档名互不相撞', () => {
    const kinds = BUILTIN_CARD_PARTS.map((part) => part.kind)

    expect(new Set(kinds).size).toBe(kinds.length)
  })
})

describe('字段并集', () => {
  // ⚠ 重名的后果是两个部件共用一个取值：改这个的颜色，另一个跟着变
  it('前缀化后没有重名的键', () => {
    expect(duplicateFieldKeys(BUILTIN_CARD_PARTS)).toEqual([])
  })

  // ⚠ 指空的条件恒不满足，那个字段永远不出现，而两侧都不报错
  it('每条 when 都指向并集里真存在的键', () => {
    const outer = itemSchema()
      .map((field) => field.key)
      .filter(
        (key) =>
          !BUILTIN_CARD_PARTS.some((part) =>
            part.fields.some((field) => field.key === key),
          ),
      )

    expect(danglingPartConditions(BUILTIN_CARD_PARTS, outer)).toEqual([])
  })

  // ⚠ 挂不到 kind 的字段在所有档下都出现：选了「进度条」却看见「名称」的字号
  it('每个字段都挂得到 kind 条件——直接挂或沿 when 链上溯挂到', () => {
    const loose = BUILTIN_CARD_PARTS.flatMap((part) =>
      fieldsWithoutKindCondition(part).map((key) => `${part.kind}.${key}`),
    )

    expect(loose).toEqual([])
  })

  it('并集真的进了清单：行字段里既有档位下拉，也有各档自己的键', () => {
    const keys = itemSchema().map((field) => field.key)

    expect(keys).toContain(CARD_PART_KIND_KEY)
    for (const part of BUILTIN_CARD_PARTS) {
      for (const field of part.fields) expect(keys).toContain(field.key)
    }
  })

  // ⚠ 下拉里少一档 = 那个部件加不出来；多一档 = 选了画成占位
  it('档位下拉的选项与内置清单逐字相等', () => {
    const kind = itemSchema().find((field) => field.key === CARD_PART_KIND_KEY)

    expect(kind?.options?.map((one) => one.value)).toEqual(
      BUILTIN_CARD_PARTS.map((part) => part.kind),
    )
  })
})

describe('子槽声明', () => {
  // ⚠ 声明与实际读的对不上时，绑点面板提示接 A、部件其实读 B
  it('声明的子槽都在模块真有的那几个里', () => {
    expect(strayPartSlots(BUILTIN_CARD_PARTS, CARD_SLOT_KEYS)).toEqual([])
  })

  it('模块的 arrayFields 与部件词汇表逐字相同', () => {
    const slot = manifest.bindings.find((one) => one.isArray === true)

    expect(slot?.arrayFields?.map((one) => one.key)).toEqual([
      ...CARD_SLOT_KEYS,
    ])
  })
})

describe('登记', () => {
  it('内置的都登记进了分发表——漏一个，卡片上那一件画成占位', () => {
    expect(
      missingCardParts(BUILTIN_CARD_PARTS.map((part) => part.kind)),
    ).toEqual([])
  })

  it('清空之后确实查不到，说明上面那条不是恒真', () => {
    __resetCardParts()

    expect(
      missingCardParts(BUILTIN_CARD_PARTS.map((part) => part.kind)),
    ).toEqual(BUILTIN_CARD_PARTS.map((part) => part.kind))
  })
})
