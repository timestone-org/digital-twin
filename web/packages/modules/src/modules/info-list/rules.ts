/**
 * @fileoverview 值规则的口径已提到 `shared/valueRules.ts`，卡片族读的是同一份。
 * 这里只保留转发，免得把本模块里十几处引用一并改掉——真源只有共用层那一处。
 */
export {
  evaluateValueRules,
  normalizeValueRules,
  valueRulesField,
  type ValueHit,
  type ValueRule,
} from '../../shared/valueRules'
