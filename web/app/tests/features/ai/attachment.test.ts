/**
 * @fileoverview 附件纯逻辑：结果收成待发条目、发送时文本并进那句话、图单独走。
 * 并的格式是模型侧契约的一半——「参考文件 <名>：」这个抬头变了，
 * 老会话回放里的消息就与新发的长得不一样。
 */
import { describe, expect, it } from 'vitest'
import type { AssistantParsedAttachment } from '@dt/contracts'

import {
  FALLBACK_ACCEPT,
  acceptOf,
  imagesOf,
  isImage,
  looksLikeImage,
  toPending,
  toPendingImage,
  withAttachments,
} from '@/features/ai/attachment'

function parsed(
  part: Partial<AssistantParsedAttachment>,
): AssistantParsedAttachment {
  return { is_truncated: false, text: '', summary: '', ...part }
}

/** 一条文本类待发件。 */
function textOne(name: string, text: string) {
  return { name, text, meta: '', dataUri: '' }
}

describe('toPending', () => {
  it('概况直接用服务端算好的那一句，不在界面上另算一遍', () => {
    const one = toPending('点表.csv', parsed({ summary: '2 列 × 40 行' }))
    expect(one.meta).toBe('2 列 × 40 行')
  })

  it('正文原样带过来，用户发出去前能核对助手将要看到什么', () => {
    const one = toPending('巡检.txt', parsed({ text: '一切正常' }))
    expect(one.text).toBe('一切正常')
    expect(isImage(one)).toBe(false)
  })
})

describe('toPendingImage', () => {
  it('包成 data URI，并按文件自报的类型标注', () => {
    const file = new File([''], '现场.png', { type: 'image/png' })
    const one = toPendingImage(file, 'AAAA')
    expect(one.dataUri).toBe('data:image/png;base64,AAAA')
    expect(isImage(one)).toBe(true)
  })

  it('概况里说清只这一轮看得见', () => {
    // 不说的话，用户第二句「再看看那张图」会得到一个它自己都解释不了的答复
    const file = new File([''], '现场.png', { type: 'image/png' })
    expect(toPendingImage(file, 'AAAA').meta).toContain('只这一轮')
  })
})

describe('withAttachments', () => {
  it('正文在前、附件在后，各自隔一个空行', () => {
    const text = withAttachments('照这张表绑', [textOne('点表.csv', 'a | b')])
    expect(text).toBe('照这张表绑\n\n参考文件 点表.csv：\na | b')
  })

  it('没有正文时只发附件，不带空头', () => {
    const text = withAttachments('  ', [textOne('巡检.txt', '一切正常')])
    expect(text).toBe('参考文件 巡检.txt：\n一切正常')
  })

  it('图不并进正文——它要进视觉档的图片块，摊成文字就没了', () => {
    const file = new File([''], '现场.png', { type: 'image/png' })
    const text = withAttachments('照着这张摆', [toPendingImage(file, 'AAAA')])
    expect(text).toBe('照着这张摆')
  })
})

describe('imagesOf', () => {
  it('只挑图片类，文本类不掺进来', () => {
    const file = new File([''], '现场.png', { type: 'image/png' })
    const got = imagesOf([textOne('点表.csv', 'a'), toPendingImage(file, 'A')])
    expect(got).toEqual(['data:image/png;base64,A'])
  })
})

describe('accept 名单', () => {
  it('用服务端下发的那一份', () => {
    expect(acceptOf(['.csv', '.png'])).toBe('.csv,.png')
  })

  it('服务端还没答上来时退到兜底，而不是给一个空 accept', () => {
    // 空 accept 会让文件选择器什么都收，然后在服务端逐个被拒
    expect(acceptOf([])).toBe(FALLBACK_ACCEPT)
  })
})

describe('looksLikeImage', () => {
  it('按后缀分路，大小写都认', () => {
    expect(looksLikeImage('现场.PNG')).toBe(true)
    expect(looksLikeImage('点表.csv')).toBe(false)
  })
})
