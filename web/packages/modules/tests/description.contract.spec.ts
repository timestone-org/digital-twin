/**
 * @fileoverview 守「每个内建模块都有一段给模型读的说明」：`ModuleManifest.description`
 * 在类型上是可选的（测试夹具与第三方清单不必逐个补），完整性只能由本文件兜。
 * ⚠ 没有这道闸，新加的模块会悄悄地不带描述进服务端目录，而 AI 助手拿到的名片上
 * 只剩类型名与关键词——它于是靠模块名猜这块是干什么的，选错模块、配错字段，
 * 而两侧都不报错（AI_ASSISTANT_V3_PLAN §3）。
 */
import { beforeAll, describe, expect, it } from 'vitest'

import { buildModuleCatalog } from '../src/catalog'
import { registerBuiltinModules } from '../src/registerBuiltins'
import { __resetModules, listModules } from '../src/registry'

/**
 * 一段合格描述的字数下限。
 * ⚠ 规格要的是 3–6 句、答清「这是什么 / 什么时候别用它 / 槽怎么喂 / 真有的那条坑」，
 * 短于这个数的必然是一句空话，而空话比没有更糟——模型会照着它配。
 */
const MIN_DESCRIPTION_LENGTH = 100
const MAX_DESCRIPTION_LENGTH = 180

/** 描述是给模型读的说明，不是界面文案；这几句正确的废话等于没写。 */
const EMPTY_PHRASES = ['用于展示', '用来展示', '一个模块', '本模块用于']
const COLLOQUIAL_PHRASES = ['改喂', '摆着不生效', '画不出来', '够用', '压根']

beforeAll(() => {
  __resetModules()
  registerBuiltinModules()
})

describe('内建模块的描述', () => {
  it('每一个都有描述', () => {
    const missing = listModules()
      .filter((manifest) => (manifest.description ?? '') === '')
      .map((manifest) => manifest.type)

    expect(missing).toEqual([])
  })

  it('每一段描述都长过下限', () => {
    const short = listModules()
      .filter(
        (manifest) =>
          (manifest.description ?? '').length < MIN_DESCRIPTION_LENGTH,
      )
      .map(
        (manifest) => `${manifest.type}:${manifest.description?.length ?? 0}`,
      )

    expect(short).toEqual([])
  })

  it('描述里没有「用于展示实时数值」这类正确的废话', () => {
    const hollow = listModules().flatMap((manifest) =>
      EMPTY_PHRASES.filter((phrase) =>
        (manifest.description ?? '').includes(phrase),
      ).map((phrase) => `${manifest.type}:${phrase}`),
    )

    expect(hollow).toEqual([])
  })

  it('全部描述保持 3–4 句与 100–180 字', () => {
    const invalid = listModules().flatMap((manifest) => {
      const description = manifest.description ?? ''
      const sentences = description.match(/[。！？]/g)?.length ?? 0
      const length = description.length
      return length >= MIN_DESCRIPTION_LENGTH &&
        length <= MAX_DESCRIPTION_LENGTH &&
        sentences >= 3 &&
        sentences <= 4
        ? []
        : [`${manifest.type}:${String(length)}字/${String(sentences)}句`]
    })

    expect(invalid).toEqual([])
  })

  it('描述不使用口语化表达', () => {
    const colloquial = listModules().flatMap((manifest) =>
      COLLOQUIAL_PHRASES.filter((phrase) =>
        (manifest.description ?? '').includes(phrase),
      ).map((phrase) => `${manifest.type}:${phrase}`),
    )

    expect(colloquial).toEqual([])
  })

  // 描述写进了清单却漏了序列化，服务端目录里就没有这一键——现象与「没写描述」
  // 完全一样，而清单侧的三条用例全绿
  it('描述序列化进了服务端目录', () => {
    const catalog = buildModuleCatalog(listModules())
    const modules = catalog.modules

    expect(Array.isArray(modules)).toBe(true)
    const described = (Array.isArray(modules) ? modules : []).filter(
      (module) =>
        typeof module === 'object' &&
        module !== null &&
        !Array.isArray(module) &&
        typeof module.description === 'string' &&
        module.description.length >= MIN_DESCRIPTION_LENGTH,
    )

    expect(described).toHaveLength(listModules().length)
  })
})
