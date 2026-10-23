/** @fileoverview 公式从已保存的实际模型参数代入，缺失记录不猜当前默认。 */
import { describe, expect, it } from 'vitest'

import { formulaText } from '@/pages/Modeling/Canvas/scripts/formula'
import type { FormulaContext } from '@/pages/Modeling/Canvas/scripts/formulaCatalog'
import { formulasOf } from '@/pages/Modeling/Canvas/scripts/formulaCatalog'
import { portPreviewsOf } from '@/pages/Modeling/Canvas/scripts/preview'

function context(
  hyper: Record<string, unknown>,
  fitted: Record<string, unknown> = {},
  config: Record<string, unknown> = {},
): FormulaContext {
  return {
    blocks: [],
    config,
    ports: portPreviewsOf({
      model: {
        kind: 'model',
        task: 'anomaly_detection',
        algo: 'anomaly_distance',
        feature_keys: ['温度'],
        target_key: null,
        serving_channel: 'json',
        hyper_params: hyper,
        fitted,
      },
    }),
  }
}

describe('模型实际参数来源', () => {
  it('raw配置未写分位数时从已保存超参取得，并代入已学到的距离阈值', () => {
    const spec = formulasOf(
      'anomaly_distance',
      context({ quantile: 0.975 }, { distance_threshold: 7.25 }),
    )[0]
    expect(formulaText(spec?.filled ?? [])).toContain('q = 0.975')
    expect(formulaText(spec?.filled ?? [])).toContain('τ = 7.25')
    expect(spec?.fallback).toBeNull()
  })

  it('实际模型超参优先于不一致的原始快照值', () => {
    const spec = formulasOf(
      'anomaly_distance',
      context({ quantile: 0.975 }, {}, { quantile: 0.96 }),
    )[0]
    expect(formulaText(spec?.filled ?? [])).toContain('q = 0.975')
  })

  it('规则类型从已保存模型取得，不误用空配置时的当前默认', () => {
    const spec = formulasOf(
      'energy_rules',
      context(
        { kind: 'unit_consumption' },
        { config: { kind: 'unit_consumption' } },
      ),
    )[0]
    expect(spec?.title).toBe('单位产量能耗')
    expect(formulaText(spec?.symbolic ?? [])).toContain('E / Q')
  })

  it('未保存规则类型时不伪造温湿度达标公式', () => {
    const spec = formulasOf('energy_rules', {
      blocks: [],
      ports: [],
      config: {},
    })[0]
    expect(spec?.title).toBe('业务规则')
    expect(spec?.fallback).toContain('规则配置')
    expect(formulaText(spec?.symbolic ?? [])).not.toContain('T_min')
  })
})

describe('旧记录缺省处理方式', () => {
  it.each(['bool', 'string'])('转成 %s 时不把布尔输入声称为数值 1/0', (to) => {
    const spec = formulasOf('cast_type', {
      blocks: [],
      ports: [],
      config: { to, on_error: 'coerce' },
    })[0]
    const symbolic = formulaText(spec?.symbolic ?? [])
    expect(symbolic).toContain(`${to}(v)`)
    expect(symbolic).not.toContain('1.0 / 0.0')
  })

  it('未保存转型错误策略时不声称本次整步报错', () => {
    const spec = formulasOf('cast_type', {
      blocks: [],
      ports: [],
      config: { to: 'number' },
    })[0]
    expect(spec?.notes.join('')).not.toContain('解析不动就整步报错')
    expect(spec?.notes.join('')).toContain('未保存')
    expect(formulaText(spec?.symbolic ?? [])).toContain('on_error = coerce')
    expect(formulaText(spec?.symbolic ?? [])).toContain('on_error = error')
  })
})
