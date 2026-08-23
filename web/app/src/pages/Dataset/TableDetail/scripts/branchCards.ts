/**
 * @fileoverview 分段编辑面的展示模型：把一份草稿摊成若干张卡、每张卡若干格
 * 输入。抽出来是因为三格（条件 / 取值 / 兜底）的输入框长得一模一样，模板里
 * 写三遍必然有一处写歪，而写歪的表现是那一格插不进东西、且什么都不报。
 */

import type { BranchDraft } from './formulaText'

/**
 * 一格输入的标识：`0.cond` / `0.value` / `else`。
 * 工具箱插入靠它认「插进哪一格」。
 */
export type FieldId = string

export interface FieldView {
  id: FieldId
  /** 行首那个字：当 / 取。 */
  tag: string
  text: string
  /** 读屏用的名字；这一格没有可见 label。 */
  label: string
  placeholder: string
}

/** 一张卡：一档分支，或末尾那张「否则」。 */
export interface CardView {
  key: string
  /** 第几档；「否则」那张排在最后，不参与增删移。 */
  at: number
  isElse: boolean
  fields: FieldView[]
}

/**
 * 草稿 → 卡片。
 * ⚠ 「否则」那一档**没有条件**，故只有一格：它不是「条件恒真的一档」，
 * 给它配一个条件框会让人以为那里也能写判断。
 * @param draft 分段草稿
 */
export function toCards(draft: BranchDraft): CardView[] {
  const arms = draft.arms.map((arm, at) => ({
    key: `arm-${at}`,
    at,
    isElse: false,
    fields: [
      {
        id: `${at}.cond`,
        tag: '当',
        text: arm.cond,
        label: `第 ${at + 1} 档的条件`,
        placeholder: '如：{产量} != 0',
      },
      {
        id: `${at}.value`,
        tag: '取',
        text: arm.value,
        label: `第 ${at + 1} 档的取值`,
        placeholder: '条件成立时这一列取什么',
      },
    ],
  }))
  return [...arms, elseCard(draft.arms.length, draft.otherwise)]
}

function elseCard(at: number, otherwise: string): CardView {
  return {
    key: 'else',
    at,
    isElse: true,
    fields: [
      {
        id: 'else',
        tag: '取',
        text: otherwise,
        label: '各档都不成立时取什么',
        placeholder: '上面各档都不成立时这一列取什么',
      },
    ],
  }
}
