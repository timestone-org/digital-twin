/** @fileoverview 批量聚类与校准异常模型的算法说明及分数口径。 */
import type { FormulaContext } from './formulaArgs'
import { hyperAt, textAt } from './formulaArgs'
import { tableExplanation } from './formulaTabularArgs'

const CLUSTERS: Readonly<
  Record<string, { title: string; expression: string; note: string }>
> = {
  kmeans: {
    title: 'K 均值',
    expression: 'min sum_i ||z_i − μ_label(i)||²',
    note: '迭代分配最近中心并更新均值，目标簇数由配置给定。',
  },
  minibatch_kmeans: {
    title: '小批量 K 均值',
    expression: 'μ_next = 用一小批样本增量更新的簇中心',
    note: '通过小批次近似优化 K 均值目标；batch_size 控制每批样本数。',
  },
  gaussian_mixture: {
    title: '高斯混合',
    expression: 'p(z) = sum_k π_k·Normal(z | μ_k, Σ_k)',
    note: '按所选协方差形状拟合混合分布，标签取后验概率最大的分量；簇号不是业务真实类别。',
  },
  dbscan: {
    title: '密度聚类',
    expression: 'core(z) ⇔ count(N_eps(z)) ≥ min_samples',
    note: '邻域计数包含自身；按密度可达关系分组，无法归入簇的样本标记为 -1 噪声，不强行指定簇数。',
  },
  agglomerative: {
    title: '层次聚类',
    expression: 'merge(A,B) = 当前 linkage 距离最小的簇对',
    note: '逐次合并至目标簇数；Ward 最小化簇内方差增量并使用欧氏距离，其他合并方式使用配置距离。',
  },
  birch: {
    title: 'BIRCH 聚类',
    expression: 'CF = (样本数, sum(z_i), sum(z_i²))',
    note: '先用聚类特征树压缩子簇，再按目标簇数聚合；子簇阈值与分支数控制压缩过程。',
  },
  mean_shift: {
    title: '均值漂移',
    expression: 'center_next = mean(z_i in bandwidth(center))',
    note: '在带宽邻域内移动中心至密度峰并合并邻近峰；带宽使用固定值或按固定种子抽样估计。',
  },
  spectral: {
    title: '谱聚类',
    expression: '相似度图 → 拉普拉斯谱嵌入 → 簇分配',
    note: '相似度由径向核或近邻图构造；核系数和近邻数只在对应构造方式下生效。',
  },
}
function clustering(context: FormulaContext) {
  const algorithm = textAt(context.config, 'algorithm')
  const rule = CLUSTERS[algorithm]
  return tableExplanation(context, {
    id: 'clustering',
    title: rule ? `${rule.title}的分组依据` : '所选聚类算法的分组依据',
    expressions: [rule?.expression ?? '根据所选批量聚类算法分配标签'],
    parameters: [
      ['algorithm', '聚类算法'],
      ['should_standardize', '本批次标准化'],
      ['columns', '参与列'],
      ['output_column', '标签列'],
      ['n_clusters', '目标簇数'],
      ['eps', '邻域半径'],
      ['min_samples', '核心点邻居数'],
      ['linkage', '合并方式'],
      ['covariance_type', '协方差形状'],
      ['bandwidth_mode', '带宽口径'],
      ['silhouette_rows', '轮廓抽样上限'],
    ],
    legend: [
      {
        symbol: 'z',
        text: '参与聚类的数值向量；开启标准化时按本批次的均值和尺度转换',
      },
    ],
    notes: [
      rule?.note ?? '未记录可识别的聚类算法，不能用其他算法解释这次结果。',
      '本算子是整批探索分析，输出原始数据加字符串簇号；不产出可发布的单行模型。不同批次簇号不能直接当作同一业务类别。',
      '缺失和非有限值需先处理，目标列不参与聚类。标签 -1 保留为噪声，不充作普通簇。',
      '轮廓系数只在有效非噪声样本中计算并可固定种子抽样；不足两簇或无定义时留空，不展示伪造准确率。',
    ],
  })
}
const ANOMALIES: Readonly<
  Record<string, { title: string; expression: string; note: string }>
> = {
  isolation_forest: {
    title: '孤立森林',
    expression: 'raw = −native.score_samples(z)',
    note: '随机隔离路径越短越容易被孤立；原始分数统一翻转为越大越偏离，再使用独立校准段定阈值。',
  },
  local_outlier_factor: {
    title: '局部离群因子',
    expression: 'raw ≈ mean(邻居局部密度 / 自身局部密度)',
    note: '相对邻居密度偏低时更异常；固定使用 novelty 模式评价新样本，邻居数必须小于拟合段行数。',
  },
  one_class_svm: {
    title: '单类 SVM',
    expression: 'raw = −native.score_samples(z)',
    note: '通过核边界描述正常区域；ν 控制拟合边界，但最终异常判定使用内部留出段的校准阈值。',
  },
  elliptic_envelope: {
    title: '椭圆包络',
    expression: 'raw = (z−μ_robust)ᵀ·Σ_robust⁻¹·(z−μ_robust)',
    note: '使用稳健协方差描述椭圆正常区域；需有足够样本且避免不可辨识的共线特征。',
  },
}
function anomalyModel(context: FormulaContext) {
  const algorithm =
    textAt(context.config, 'algorithm') || hyperAt(context.ports, 'algorithm')
  const rule = ANOMALIES[algorithm]
  return tableExplanation(context, {
    id: 'anomaly-calibration',
    title: rule ? `${rule.title}的校准异常分数` : '所选正常工况模型的校准分数',
    expressions: [
      rule?.expression ?? 'raw = 统一为越大越异常的原始分数',
      'τ = Q_higher(quantile, raw_calibration)',
      'score = exp(clip((raw − τ) / scale, −30, 30))',
      'is_anomaly ⇔ score > 1',
    ],
    parameters: [
      ['algorithm', '模型算法'],
      ['quantile', '校准分位数'],
      ['calibration_ratio', '内部校准比例'],
      ['scale_floor', '标准化尺度下限'],
      ['n_estimators', '孤立树数'],
      ['n_neighbors', '邻居数'],
      ['kernel', '核函数'],
      ['nu', 'SVM 边界参数'],
    ],
    legend: [
      {
        symbol: 'scale',
        text: 'max(校准原始分数标准差, |τ|×0.000001, 0.000000001)',
      },
      {
        symbol: 'raw_calibration',
        text: '正常训练帧后段的原始异常分数，不是独立测试帧',
      },
    ],
    notes: [
      rule?.note ?? '本次运行未记录可识别算法，不能替换为旧距离模型的公式。',
      '正常训练帧按原行序分为前段拟合、后段校准；均值和尺度仅从拟合段学习，并与模型及阈值冻结。',
      '分数严格大于 1 才判异常，等于阈值仍为正常；此分数不是故障概率，也不代表检测准确率。',
      '独立测试帧只用于评价，缺失或非有限输入拒绝判定；模型不在调用时自行学习。',
    ],
  })
}
export const UNSUPERVISED_FORMULAS = {
  clustering_analysis: [clustering],
  anomaly_model: [anomalyModel],
}
