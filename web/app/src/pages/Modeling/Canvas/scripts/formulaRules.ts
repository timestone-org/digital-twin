/** @fileoverview 能源规则的公式与计量口径说明。 */
import { nameOf, opOf, run, varOf } from './formula'
import type { FormulaContext, FormulaSpec } from './formulaArgs'
import { hyperAt, textAt } from './formulaArgs'

const EXPRESSIONS: Record<
  string,
  { title: string; expression: string; note: string }
> = {
  hvac_compliance: {
    title: '达标范围逐项判断',
    expression: 'pass = (T_min ≤ T ≤ T_max) ∧ (H_min ≤ H ≤ H_max)',
    note: '上下限均包含边界；任一指标缺失时不能判为达标。',
  },
  efficiency_fluctuation: {
    title: '相对基准的能效波动',
    expression: 'Δη% = (η_current − η_reference) / η_reference × 100',
    note: '按偏差绝对值比较波动阈值；基准为零时无法核算。',
  },
  energy_aggregation: {
    title: '分类计量与折标归集',
    expression: 'E_standard = Σ(E_i × k_i)',
    note: '每个计量列只归集一次；不同原始单位不直接相加，按配置折标系数统一核算。',
  },
  energy_trace: {
    title: '路径能量与节点平衡',
    expression: 'E_received = E_sent × η; balance = ΣE_in − ΣE_out',
    note: '路径遵循有向无环拓扑，逐节点显示计量差额；差额不自动解释为泄漏原因。',
  },
  unit_consumption: {
    title: '单位产量能耗',
    expression: 'e = E / Q',
    note: '能耗与产量必须使用相同统计期间；零产量不返回伪造的零单位能耗。',
  },
  efficiency_benchmark: {
    title: '单位能耗对标偏差',
    expression:
      'ratio = e_actual / e_benchmark; deviation% = (ratio − 1) × 100',
    note: '实际与基准使用相同单位和工况，按明确配置的等级边界判定。',
  },
  equipment_efficiency: {
    title: '设备能效系数',
    expression: 'COP = P_useful / P_input',
    note: '有效输出与输入功率使用同一时段和功率单位；零输入功率时不可评估。',
  },
  supply_diagnosis: {
    title: '能源供应指标越界诊断',
    expression: 'abnormal_i = (x_i < L_i) ∨ (x_i > U_i)',
    note: '逐项返回命中的越界规则与指标；诊断不推断未观测的故障根因。',
  },
}

function energyRules(context: FormulaContext): FormulaSpec {
  const kind = hyperAt(context.ports, 'kind') || textAt(context.config, 'kind')
  const rule = EXPRESSIONS[kind]
  return {
    id: 'business-rule',
    title: rule?.title ?? '业务规则',
    symbolic: [run(varOf(rule?.expression ?? 'y = rules(x)'))],
    filled:
      rule !== undefined
        ? [run(nameOf('规则'), opOf('='), nameOf(kind))]
        : null,
    fallback: '计算参数与列映射保存在规则配置中，完整核算明细由模型服务返回。',
    isOpen: false,
    legend: [{ symbol: 'x', text: '按模型输入签名提供的计量值' }],
    notes: [
      rule?.note ?? '先选择业务规则。',
      '使用十进制核算；此模型不通过训练近似业务公式。',
    ],
  }
}

export const ENERGY_RULE_FORMULAS = { energy_rules: [energyRules] }
