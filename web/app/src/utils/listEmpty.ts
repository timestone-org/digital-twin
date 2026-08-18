/**
 * @fileoverview 列表的两种「空」：筛出来是空的，和这里本来就什么都没有。
 *
 * ⚠ 合成一种会造出一条**让人做错事**的引导：点位表在搜不到时说「去浏览树里
 * 勾选导入」，工程师真的会再导一遍，于是同一批点位被导入两次；空调台账说
 * 「先去空间配置建车间」，而车间明明建好了，只是筛选条件没匹配上。
 * ⚠ 筛出来是空的那一种**不给任何创建入口**：那时候用户要的是改条件，不是
 * 再建一个（大屏网格那条空态早就是这么写的，见 DashboardGridEmpty）。
 */
import type { DtDataViewEmpty } from '@dt/contracts'

export interface ListEmptyInput {
  /** 此刻有没有任何筛选条件生效（关键词、下拉、时间窗都算）。 */
  isFiltered: boolean
  /** 列表里装的是什么，用于组文案：「点位」「空调」。 */
  subject: string
  /** 关键词；只按下拉筛选时是空串，那时文案不提「名字含」。 */
  keyword?: string | undefined
  /** 一条都没配过时的引导，由各页自己写——只有它们知道下一步该去哪。 */
  blank: DtDataViewEmpty
}

/**
 * 按「有没有筛选」挑一种空态。
 * @param input 筛选状态、列表主体与「本来就没有」时的引导
 */
export function listEmptyState(input: ListEmptyInput): DtDataViewEmpty {
  if (!input.isFiltered) return input.blank
  const keyword = input.keyword?.trim() ?? ''
  return {
    title: `没有匹配的${input.subject}`,
    hint:
      keyword === ''
        ? `当前筛选条件下一个${input.subject}都没有，换个条件试试。`
        : `没有名字含「${keyword}」的${input.subject}，换个词或清掉筛选条件试试。`,
  }
}
