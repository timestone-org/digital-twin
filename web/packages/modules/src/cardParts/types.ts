/**
 * @fileoverview 卡片部件的契约：一个部件声明什么、渲染时收到什么。
 * 部件是「格里的一个小件」——读数、进度条、徽章、涨跌块……用户在一格里加哪几个、
 * 按什么顺序摆，由他自己定（docs/MODULE_DATA_CARD_DESIGN.md）。
 *
 * ⚠ 本文件只定**机制**的词汇表，不认识任何一个具体部件，也不认识任何模块类型。
 */
import type { ConfigField, ModuleSlotMeta } from '@dt/contracts'
import type { Component } from 'vue'

/**
 * 一格能接的子槽。部件从这四个里**挑**，不新增。
 *
 * ⚠ 槽位静态是整条链的地基：槽键要落库成 `field_key` 并被服务端按**构建期导出的**
 * 目录校验（ADR-0012 五）。部件是用户动态加的，若让它生成槽，服务端就得跟着动态
 * 校验，而那份目录根本没有它。
 * ⚠ 摆卡片的模块必须把 `arrayFields` 声明成与这里逐字相同的一组，由契约测试钉死——
 * 两边漂了的表现是「绑点面板提示接 A、部件其实读 B」，而两侧都不报错。
 */
export const CARD_SLOT_KEYS = ['value', 'aux', 'ratio', 'state'] as const
export type CardSlotKey = (typeof CARD_SLOT_KEYS)[number]

/** 逐档子槽是什么意思。给人看，也随模块清单下发给模型。 */
export const CARD_SLOT_DOCS: Readonly<Record<CardSlotKey, string>> = {
  value: '主读数。大字读数、进度条、涨跌块、迷你折线都先读它。',
  aux: '第二个数：涨跌块的对比值、进度条的目标线、副读数。',
  ratio:
    '占比，0–100。进度条优先读它；不接时由 `value` 与部件自己配的量程算，所以多数场合可以不接。',
  state:
    '状态码。徽章与状态点按它分档，工控点位的状态多半是 0/1/2/3 这样的数字编码。',
}

/**
 * 格级的格式口径。**同一格里所有部件共用一份**——单位与小数位是「这一格在说哪个量」
 * 的属性，不是某个部件的观感。
 *
 * ⚠ 不让每个部件各配一遍：三个部件读同一个值却显示成三种小数位，是用户第一眼
 * 就会当成 bug 的那种不一致。
 */
export interface CardCellFormat {
  unit: string
  precision: number
  /** 取不到值时画在读数位的符号。⚠ 缺值绝不伪造 0。 */
  emptyText: string
  thousands: boolean
  /** 按 `precision` 补零对齐（42.00 / 3.50），读数跳动时位数不变。 */
  fixedDecimals: boolean
}

/** 部件收到的这一格的取值与口径。 */
export interface CardCellView {
  /**
   * 这一格的名称，格自己配的；空串 = 没起名字。
   * ⚠ 它不是槽：名字是配置，不从点位来。
   */
  label: string
  /** 这一格各子槽的取值；**取不到的键不存在**，不拿 null 冒充「现场报的就是空」。 */
  values: Readonly<Partial<Record<CardSlotKey, unknown>>>
  format: CardCellFormat
}

/**
 * 部件收到的这一格逐子槽取数结论。
 * ⚠ 收窄过：部件拿不到 `ModuleMeta`。给了整块的四档，部件里就会长出
 * 「整块都没绑就别画」这种越权判断，而那是模块壳的事。
 */
export interface CardPartMeta {
  /**
   * 逐子槽的取数结论；**没配过来源的槽不在表里**——「没接」与「接了取不到」
   * 靠键在不在分得开。
   */
  slots: Readonly<Partial<Record<CardSlotKey, ModuleSlotMeta>>>
}

/** 一个部件的渲染组件收到的 props。三件套固定，与 `ModuleComponentProps` 同理。 */
export interface CardPartProps {
  /** 这一条部件自己的配置，键**已去前缀**。 */
  part: Record<string, unknown>
  cell: CardCellView
  meta: CardPartMeta
}

/** 作者写的部件定义；键与 `when` 由 `defineCardPart` 统一前缀化后才成为下面那份。 */
export interface CardPartInput {
  /**
   * 部件档名。
   * ⚠ 别用常见单词：「零模块类型字面量」那道闸按已注册名逐个 grep 源码，
   * `text` / `card` 这类词会红在一堆毫不相干的属性上（action-button 的教训）。
   */
  kind: string
  label: string
  /** 部件面板上的图标，须在 DtIcon 注册表里；写错不报错也不渲染。 */
  icon: string
  /** 一句话：什么时候用它、什么时候该用旁边那个。给人也给模型看。 */
  hint: string
  /** 这一档自己的配置字段，键按未前缀化的写。 */
  fields: ConfigField[]
  /** 它读哪几个子槽。绑点面板据此提示这一格该接什么。 */
  slots: readonly CardSlotKey[]
  /** ⚠ 必须异步：不摆这个部件的大屏不该为它的代码付首屏包体。 */
  component: () => Promise<{ default: Component }>
}

/** 前缀化之后的部件定义，注册表里存的是它。 */
export interface CardPartDefinition extends CardPartInput {
  /** 字段键已前缀化成 `<kind>-<key>`，且都带得到 `kind` 条件（可能是沿链上溯拿到的）。 */
  fields: ConfigField[]
}
