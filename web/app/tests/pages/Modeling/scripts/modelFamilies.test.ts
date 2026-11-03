/** @fileoverview 四类模型族覆盖真实算法清单，说明区分学习目标与校准口径。 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { formulasOf } from '@/pages/Modeling/Canvas/scripts/formulaCatalog'
import { formulaText } from '@/pages/Modeling/Canvas/scripts/formula'
import {
  algorithmOptions,
  modelAlgorithmName,
  operatorSearchText,
} from '@/pages/Modeling/Canvas/scripts/modelPresentation'
import type { ModelingOperator } from '@dt/contracts'

const root = join(
  process.cwd(),
  '../server/services/platform-server/src/platform_server/apps/modeling/operators',
)
function algorithms(file: string, alias: string): string[] {
  const text = readFileSync(join(root, file), 'utf8')
  const body = text.match(
    new RegExp(`type ${alias} = Literal\\[([\\s\\S]*?)\\]`),
  )?.[1]
  if (!body) throw new Error(`未找到算法契约 ${alias}`)
  return [...body.matchAll(/"([a-z_]+)"/g)].map((match) => match[1] ?? '')
}
function formula(code: string, config: Record<string, unknown>) {
  const spec = formulasOf(code, { blocks: [], ports: [], config })[0]
  if (!spec) throw new Error(`缺少${code}公式`)
  return spec
}
it.each([
  ['regression_model', 'supervised_config.py', 'RegressionAlgorithm', 18],
  [
    'classification_model',
    'supervised_config.py',
    'ClassificationAlgorithm',
    19,
  ],
  ['clustering_analysis', 'unsupervised_config.py', 'ClusterAlgorithm', 8],
  ['anomaly_model', 'unsupervised_config.py', 'AnomalyAlgorithm', 4],
] as const)(
  '%s 对每个真实可执行算法给出专属说明',
  (code, file, alias, count) => {
    const choices = algorithms(file, alias)
    expect(choices).toHaveLength(count)
    for (const algorithm of choices) {
      const spec = formula(code, { algorithm })
      expect(spec.title).not.toContain('所选')
      expect(spec.notes.join('')).not.toContain('未记录可识别')
      expect(formulaText(spec.symbolic).length).toBeGreaterThan(5)
      expect(spec.filled).not.toBeNull()
    }
  },
)
it('AdaBoostRegressor使用加权中位数，森林使用预测平均', () => {
  expect(
    formulaText(
      formula('regression_model', { algorithm: 'adaboost' }).symbolic,
    ),
  ).toContain('weighted_median')
  expect(
    formulaText(
      formula('regression_model', { algorithm: 'random_forest' }).symbolic,
    ),
  ).toContain('/ M')
})
it('核分类不提供伪概率，多分类保留真实类别且不沿用二分类阈值', () => {
  expect(
    formula('classification_model', { algorithm: 'svc' }).notes.join(''),
  ).toContain('未启用概率')
  expect(
    formula('classification_model', { algorithm: 'logistic' }).notes.join(''),
  ).toContain('不套用旧二分类')
  expect(
    formula('classification_model', { algorithm: 'sgd' }).notes.join(''),
  ).toContain('hinge')
})
it('聚类明确噪声、整批分析与不可发布；异常模型使用真实指数校准', () => {
  const cluster = formula('clustering_analysis', { algorithm: 'dbscan' })
  expect(cluster.notes.join('')).toContain('-1 噪声')
  expect(cluster.notes.join('')).toContain('不产出可发布')
  const anomaly = formula('anomaly_model', { algorithm: 'one_class_svm' })
  expect(formulaText(anomaly.symbolic)).toContain('exp(clip(')
  expect(formulaText(anomaly.symbolic)).toContain('score > 1')
  expect(anomaly.notes.join('')).toContain('不是故障概率')
  expect(anomaly.notes.join('')).toContain('后段校准')
})
it('宏平均逐类排除无定义值，不把平均F1当平均P/R的调和平均', () => {
  const macro = formula('classification_metrics', { average: 'macro' })
  expect(formulaText(macro.symbolic)).toContain('metric_macro')
  expect(macro.notes.join('')).toContain('独立排除无定义')
  expect(macro.notes.join('')).toContain('不是对平均精确率')
  const weighted = formula('classification_metrics', { average: 'weighted' })
  expect(formulaText(weighted.symbolic)).toContain('support_c')
})
const operator: ModelingOperator = {
  code: 'regression_model',
  name: '通用回归',
  category: 'model',
  description: '',
  spec_version: '1',
  icon: 'table',
  inputs: [],
  outputs: [],
  config_schema: {
    properties: {
      algorithm: {
        type: 'string',
        enum: ['ridge', 'svr'],
        description: 'ridge=岭回归；svr=支持向量回归',
      },
    },
  },
  fit_required: true,
  serving_enabled: true,
  serving_window_required: false,
  serving_channel: 'binary',
}
it('算法名与检索取Schema标签，未知历史算法原样保留', () => {
  expect(algorithmOptions(operator)).toHaveLength(2)
  expect(operatorSearchText(operator)).toContain('支持向量回归')
  expect(operatorSearchText(operator)).toContain('svr')
  expect(
    modelAlgorithmName(operator, { algorithm: 'svr' }, 'regression_model'),
  ).toBe('支持向量回归')
  expect(modelAlgorithmName(undefined, {}, 'future_algorithm')).toBe(
    'future_algorithm',
  )
  expect(modelAlgorithmName(operator, {}, 'future_algorithm')).toBe(
    'future_algorithm',
  )
  expect(
    modelAlgorithmName(
      operator,
      { algorithm: 'future_algorithm' },
      'regression_model',
    ),
  ).toBe('future_algorithm')
})
it('公式实参仅显示当前算法可见的参数', () => {
  const specs = formulasOf('regression_model', {
    blocks: [],
    ports: [],
    config: { algorithm: 'svr', alpha: 5, c_value: 2 },
    schema: {
      properties: {
        algorithm: { type: 'string' },
        alpha: {
          type: 'number',
          'x-dt-visible-when': { algorithm: ['ridge'] },
        },
        c_value: {
          type: 'number',
          'x-dt-visible-when': { algorithm: ['svr'] },
        },
      },
    },
  })
  const text = formulaText(specs[0]?.filled ?? [])
  expect(text).toContain('惩罚 C = 2')
  expect(text).not.toContain('正则强度')
})

it.each(['xgboost', 'lightgbm', 'catboost'])(
  '%s 在回归和分类中具有原生算法说明',
  (algorithm) => {
    const regression = formula('regression_model', { algorithm })
    const classification = formula('classification_model', { algorithm })
    expect(regression.title.toLowerCase()).toContain(algorithm)
    expect(classification.title.toLowerCase()).toContain(algorithm)
    expect(regression.notes.join('')).toContain('原生')
    expect(classification.notes.join('')).toContain('原生')
  },
)
