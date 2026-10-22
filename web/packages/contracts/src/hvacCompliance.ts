/** @fileoverview 从 platform OpenAPI 生成的空调季节达标契约。 */
export interface HvacComplianceSchemas {
  MetricLimitIn: {
    lower_limit?: string | null
    metric: string
    upper_limit?: string | null
  }
  MetricLimitOut: {
    lower_limit: string | null
    metric: string
    upper_limit: string | null
  }
  WinterPeriodIn: { end: string; start: string }
  CompliancePolicyIn: {
    non_winter: HvacComplianceSchemas['MetricLimitIn'][]
    winter?: HvacComplianceSchemas['MetricLimitIn'][]
    winter_period?: HvacComplianceSchemas['WinterPeriodIn'] | null
  }
  CompliancePolicyOut: {
    effective_at: string
    effective_season: 'winter' | 'non_winter'
    non_winter: HvacComplianceSchemas['MetricLimitOut'][]
    timezone: string
    winter: HvacComplianceSchemas['MetricLimitOut'][]
    winter_period: HvacComplianceSchemas['WinterPeriodIn'] | null
  }
  EffectiveComplianceOut: {
    limits: HvacComplianceSchemas['MetricLimitOut'][]
    season: 'winter' | 'non_winter'
    serial: string
  }
}
export type AcCompliancePolicyInput =
  HvacComplianceSchemas['CompliancePolicyIn']
export type AcCompliancePolicy = HvacComplianceSchemas['CompliancePolicyOut']
export type AcEffectiveCompliance =
  HvacComplianceSchemas['EffectiveComplianceOut']
export type AcWinterPeriod = HvacComplianceSchemas['WinterPeriodIn']
