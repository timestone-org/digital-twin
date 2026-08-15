/**
 * @fileoverview 素材引用与取回地址的口径。
 * ⚠ 这一份漂了不会报错，只会 404：服务端把字节放在 `models/<id>/original`，
 * 这里去取别的键，大屏上那一块就永远转圈。跨语言一致由服务端的
 * `test_asset_url_contract.py` 读本包的源码比对钉住。
 */
import { describe, expect, it } from 'vitest'

import {
  ASSET_KINDS,
  assetObjectKey,
  assetRef,
  assetUrl,
  parseAssetRef,
} from '../src/asset'

const ID = '0192f0aa-0000-7000-8000-000000000001'

describe('素材引用', () => {
  it('构造与解析是一对', () => {
    expect(parseAssetRef(assetRef(ID))) .toBe(ID)
  })

  it('容忍首尾空白：配置往返一趟常常带上它', () => {
    expect(parseAssetRef(`  asset:${ID} `)).toBe(ID)
  })

  it('裸 uuid 不是引用', () => {
    expect(parseAssetRef(ID)).toBeNull()
  })

  it('URL 不是引用——存 URL 正是下一次部署就 404 的写法', () => {
    expect(parseAssetRef('https://cdn.example.com/a.glb')).toBeNull()
  })

  it('前缀对但 id 不是 uuid 时拒绝', () => {
    expect(parseAssetRef('asset:not-a-uuid')).toBeNull()
    expect(parseAssetRef('asset:')).toBeNull()
  })
})

describe('对象键', () => {
  it('每一类各有一个键，互不相同', () => {
    const keys = ASSET_KINDS.map((kind) => assetObjectKey(kind, ID))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('模型落在自己的前缀下，将来的派生件与它同处一地', () => {
    expect(assetObjectKey('model', ID)).toBe(`models/${ID}/original`)
  })

  it('图片与图标是平的一个对象', () => {
    expect(assetObjectKey('image', ID)).toBe(`images/${ID}`)
    expect(assetObjectKey('icon', ID)).toBe(`icons/${ID}`)
  })
})

describe('取回地址', () => {
  it('前缀 + 对象键', () => {
    expect(assetUrl('/oss/', 'model', assetRef(ID))).toBe(
      `/oss/models/${ID}/original`,
    )
  })

  // ⚠ 少一个斜杠拼出来的是 /ossmodels/…，那是一条谁都解释不了的 404
  it('前缀没带斜杠时自己补上', () => {
    expect(assetUrl('/oss', 'model', assetRef(ID))).toBe(
      `/oss/models/${ID}/original`,
    )
  })

  it('引用不合法时给空串，不拼出一条半截地址', () => {
    expect(assetUrl('/oss/', 'model', 'nonsense')).toBe('')
    expect(assetUrl('/oss/', 'model', '')).toBe('')
  })
})
