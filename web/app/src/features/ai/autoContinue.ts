/** @fileoverview 循环代发「自动继续」时的两句固定话：落库消息的开头与时间线上的提示。 */

/** 循环代发的催促消息的开头（turnRunner 的 PLAN_CONTINUE_TEXT 以它起头）。 */
export const AUTO_CONTINUE_PREFIX = '（自动继续）'

/** 代发催促时时间线上那条 note；回放把催促消息还原成同一句。 */
export const PLAN_CONTINUE_NOTE = '计划还没走完，自动继续。'
