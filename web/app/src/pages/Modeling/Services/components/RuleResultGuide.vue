<script setup lang="ts">
/** @fileoverview 八类规则模型的结构化返回字段说明。 */
const RESULTS = [
  {
    kind: 'hvac_compliance',
    name: '空调机组达标检测',
    fields:
      'is_compliant：是否达标；violations：未达标指标；observations：本次观测。',
  },
  {
    kind: 'efficiency_fluctuation',
    name: '能效波动分析',
    fields:
      'change_pct：相对基准的变化百分比；threshold_pct：判定阈值；is_fluctuating：是否超限。',
  },
  {
    kind: 'energy_aggregation',
    name: '能耗分类归集',
    fields:
      'breakdown：各类别期间用量与折标煤量；meters：逐表计明细；totals_by_unit：按单位汇总；total_standard_coal_kg：总折标煤量。',
  },
  {
    kind: 'energy_trace',
    name: '能源流向追溯',
    fields:
      'paths：有向能源路径；edges：逐边输入、送达与损耗；nodes：逐节点收支与差额；conservation_residual：守恒残差；is_balanced：是否平衡。',
  },
  {
    kind: 'unit_consumption',
    name: '单位能耗核算',
    fields:
      'energy：期间能耗；output：期间产量；unit_consumption：单位产量能耗。',
  },
  {
    kind: 'efficiency_benchmark',
    name: '能效对标分析',
    fields:
      'ratio：实际单位能耗与基准比值；deviation_pct：偏差百分比；grade：good 良好、attention 关注或 inefficient 偏高。',
  },
  {
    kind: 'equipment_efficiency',
    name: '设备能效评估',
    fields:
      'cop：能效系数；threshold：能效下限；grade：efficient 达标或 inefficient 偏低。',
  },
  {
    kind: 'supply_diagnosis',
    name: '能源供应异常诊断',
    fields:
      'is_abnormal：是否存在指标越界；diagnosis_codes：命中的异常代码；matched_rules：越界指标、观测值与限值。',
  },
]
</script>

<template>
  <details class="dt-ml-rule-guide">
    <summary>查看规则计算的结果字段</summary>
    <p>
      每个输入行对应一个 results 元素，kind
      标识规则类型。精确核算值使用十进制字符串返回；summary_value
      仅用于摘要展示。
    </p>
    <dl>
      <template v-for="result in RESULTS" :key="result.kind">
        <dt>
          {{ result.name }} <code>{{ result.kind }}</code>
        </dt>
        <dd>{{ result.fields }}</dd>
      </template>
    </dl>
  </details>
</template>

<style scoped lang="scss">
.dt-ml-rule-guide {
  color: var(--text-secondary);
  font-size: var(--ctl-hint-fs-md);

  summary {
    cursor: pointer;
    color: var(--text-primary);
  }
  dt {
    margin-top: 0.75rem;
    color: var(--text-title);
  }
  dd {
    margin: 0.25rem 0 0;
    overflow-wrap: anywhere;
  }
  code {
    font-family: var(--font-mono);
  }
}
</style>
