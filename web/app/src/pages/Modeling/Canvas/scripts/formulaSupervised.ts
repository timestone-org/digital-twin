/** @fileoverview 通用回归和分类各算法的计算口径，实参来自运行时配置快照。 */
import type { FormulaContext } from './formulaArgs'
import { hyperAt, textAt } from './formulaArgs'
import { tableExplanation } from './formulaTabularArgs'
import { fieldsOf } from '@/features/modeling-config/scripts/schemaForm'

interface AlgorithmExplanation {
  title: string
  expression: string
  note: string
}
const REGRESSION: Readonly<Record<string, AlgorithmExplanation>> = {
  xgboost: {
    title: 'XGBoost 回归',
    expression: 'obj = sum_i loss(y_i,F(x_i)) + sum_t Ω(tree_t)',
    note: '使用原生 XGBoost 回归估计器，在提升树目标中加入复杂度正则；不是 sklearn 梯度提升的别名。',
  },
  lightgbm: {
    title: 'LightGBM 回归',
    expression: 'F_M(x) = F_0(x) + η·sum(h_m(bin(x)))',
    note: '使用原生 LightGBM 回归估计器，以直方图特征寻找切分并按叶子增益生长；叶子数和深度共同限制复杂度。',
  },
  catboost: {
    title: 'CatBoost 回归',
    expression: 'F_M(x) = F_0(x) + η·sum(tree_m(x))',
    note: '使用原生 CatBoost 回归估计器训练提升树；当前流水线输入为整理后的数值特征，不因品牌名称自动识别文本或类别特征。',
  },

  ridge: {
    title: '岭回归',
    expression: 'β = argmin(||y−Xβ||² + α||β||²)',
    note: 'L2 惩罚收缩系数；截距由拟合截距开关控制。',
  },
  lasso: {
    title: 'Lasso 回归',
    expression: 'β = argmin(||y−Xβ||²/(2n) + α||β||₁)',
    note: 'L1 惩罚可将部分系数压为零，α 越大惩罚越强。',
  },
  elastic_net: {
    title: '弹性网络回归',
    expression: 'penalty = α·ρ||β||₁ + α·(1−ρ)||β||²/2',
    note: '平方误差平均损失加此惩罚；ρ 对应 L1 正则占比。',
  },
  bayesian_ridge: {
    title: '贝叶斯岭回归',
    expression: 'ŷ = x·E[β | X,y] + b',
    note: '高斯先验和噪声假设下估计系数后验；此接口输出点预测，不冒充预测区间。',
  },
  huber: {
    title: 'Huber 稳健回归',
    expression: 'loss = 小残差用平方，大残差用线性惩罚',
    note: 'Huber 阈值相对学习到的残差尺度判断，另加 L2 惩罚；并非直接删除离群行。',
  },
  sgd: {
    title: '随机梯度线性回归',
    expression: 'β_next = β − η·gradient(loss + penalty)',
    note: '损失由 squared_error、huber 或 epsilon_insensitive 选择，使用迭代更新而非闭式求解。',
  },
  decision_tree: {
    title: '决策树回归',
    expression: 'ŷ(x) = mean(y_train in leaf(x))',
    note: '按特征分割训练数据，叶子输出该训练区域的均值；深度、叶子数和最少叶子样本控制复杂度。',
  },
  random_forest: {
    title: '随机森林回归',
    expression: 'ŷ(x) = sum(T_m(x)) / M',
    note: '对随机抽样训练的多棵树预测取平均；不会沿线性趋势外推。',
  },
  extra_trees: {
    title: '极端随机树回归',
    expression: 'ŷ(x) = sum(T_m(x)) / M',
    note: '切分候选阈值也引入随机性，再平均各树预测；随机性与随机森林训练过程不同。',
  },
  gradient_boosting: {
    title: '梯度提升回归',
    expression: 'F_M(x) = F_0(x) + η·sum(h_m(x))',
    note: '后续树逐步修正当前损失的负梯度，η 是提升学习率。',
  },
  hist_gradient_boosting: {
    title: '直方图梯度提升回归',
    expression: 'F_M(x) = F_0(x) + η·sum(h_m(bin(x)))',
    note: '先用直方图分箱寻找切分；本系统显式限制提升轮数，不使用测试帧提前停止。',
  },
  adaboost: {
    title: 'AdaBoost 回归',
    expression: 'ŷ(x) = weighted_median({T_m(x), w_m})',
    note: '调整训练样本权重后组合弱学习器，最终使用加权中位数，不是各树预测的算术平均。',
  },
  knn: {
    title: '近邻回归',
    expression: 'ŷ(x) = sum(w_i·y_i) / sum(w_i)',
    note: '只使用所选数量的最近训练邻居；uniform 等权，distance 按距离加权，精确重合点有专门处理。',
  },
  svr: {
    title: '支持向量回归',
    expression: 'ŷ(x) = sum((α_i−α_i*)·K(x_i,x)) + b',
    note: 'ε 以内误差不处罚，C 控制偏离的惩罚；核函数、γ 和多项式次数按配置生效。',
  },
  mlp: {
    title: '多层感知机回归',
    expression: 'h_(l+1) = activation(W_l·h_l + b_l)',
    note: '隐藏层宽度和激活函数决定网络结构，末层输出连续数值；本系统不使用测试帧提前停止。',
  },
}
const CLASSIFICATION: Readonly<Record<string, AlgorithmExplanation>> = {
  xgboost: {
    title: 'XGBoost 分类',
    expression: 'ŷ = argmax_c P_native(c | x)',
    note: '使用原生 XGBoost 分类估计器优化分类目标，将原始数值类别编码后训练，再按冻结映射还原；不把树原始得分直接当概率。',
  },
  lightgbm: {
    title: 'LightGBM 分类',
    expression: 'ŷ = argmax_c P_native(c | x)',
    note: '使用原生 LightGBM 分类估计器，通过直方图切分和叶子生长优化分类损失；输出保持原始类别值，类号不作连续量平均。',
  },
  catboost: {
    title: 'CatBoost 分类',
    expression: 'ŷ = argmax_c P_native(c | x)',
    note: '使用原生 CatBoost 分类估计器逐步提升分类得分；本系统传入数值特征并保留类别映射，不自动开启文本特征处理。',
  },

  logistic: {
    title: '多分类逻辑回归',
    expression: 'ŷ = argmax_c P(c | x)',
    note: '二分类使用逻辑概率，多分类使用各类线性得分对应的概率；不套用旧二分类算子的自定义正类阈值。',
  },
  sgd: {
    title: '随机梯度分类',
    expression: 'w_next = w − η·gradient(class_loss + penalty)',
    note: 'hinge 为间隔分类且不输出概率；log_loss 和 modified_huber 可提供模型自身的概率。',
  },
  decision_tree: {
    title: '决策树分类',
    expression: 'ŷ(x) = argmax_c P_train(c | leaf(x))',
    note: '沿树分割到叶子，根据叶子中加权类别分布决定预测；支持多分类。',
  },
  random_forest: {
    title: '随机森林分类',
    expression: 'P(c | x) = mean_m(P_m(c | x))',
    note: '先平均多棵树的类别概率，再选择概率最大的类别；不同于直接平均类别编号。',
  },
  extra_trees: {
    title: '极端随机树分类',
    expression: 'P(c | x) = mean_m(P_m(c | x))',
    note: '训练时随机选择切分阈值，平均多棵树的类别概率；类别编号不能当作连续数值求平均。',
  },
  gradient_boosting: {
    title: '梯度提升分类',
    expression: 'F_M(x) = F_0(x) + η·sum(h_m(x))',
    note: '逐步优化分类损失，将累计得分转为类别概率后判类；不是用回归残差直接作为概率。',
  },
  hist_gradient_boosting: {
    title: '直方图梯度提升分类',
    expression: 'F_M(x) = F_0(x) + η·sum(h_m(bin(x)))',
    note: '在分箱特征上优化分类损失；提升轮数由配置控制，不读取测试帧提前停止。',
  },
  adaboost: {
    title: 'AdaBoost 分类',
    expression: 'ŷ = argmax_c sum(w_m·I(T_m(x)=c))',
    note: '根据弱分类器误差调整权重后组合类别投票，预测结果仍使用原始类别值。',
  },
  knn: {
    title: '近邻分类',
    expression: 'ŷ = argmax_c sum(w_i·I(y_i=c))',
    note: '按最近训练邻居的等权或距离权重投票；需要合理尺度，邻居数不能超过训练样本数。',
  },
  svc: {
    title: '核支持向量分类',
    expression: 'f(x) = sum(α_i·y_i·K(x_i,x)) + b',
    note: '通过核间隔边界分类，多分类由底层估计器组合；当前构造未启用概率估计，不把决策分数冒充概率。',
  },
  linear_svc: {
    title: '线性支持向量分类',
    expression: 'ŷ = argmax_c(w_c·x + b_c)',
    note: '学习线性间隔边界；不提供原生概率，不能使用概率阈值曲线。',
  },
  gaussian_nb: {
    title: '高斯朴素贝叶斯',
    expression: 'P(c | x) ∝ P(c)·product_j Normal(x_j | μ_cj, σ²_cj)',
    note: '给定类别时假设特征条件独立，方差平滑避免零方差导致数值退化。',
  },
  bernoulli_nb: {
    title: '伯努利朴素贝叶斯',
    expression: 'z_j = I(x_j > binarize_threshold)',
    note: '按配置阈值将特征二值化，结合各类二值特征概率与先验判类；α 提供平滑。',
  },
  lda: {
    title: '线性判别分析',
    expression: 'ŷ = argmax_c log P(c | x; shared Σ)',
    note: '各类高斯分布共享协方差，得到线性决策边界；可选标准化仅使用训练数据。',
  },
  qda: {
    title: '二次判别分析',
    expression: 'ŷ = argmax_c log P(c | x; Σ_c)',
    note: '各类分别估计协方差，形成二次边界；协方差正则可缓和小样本或共线性。',
  },
  mlp: {
    title: '多层感知机分类',
    expression: 'h_(l+1) = activation(W_l·h_l + b_l)',
    note: '隐藏层输出经分类输出层形成类别概率；训练收敛和泛化仍需独立测试评估。',
  },
}
const PARAMETERS: readonly (readonly [string, string])[] = [
  ['algorithm', '本次算法'],
  ['should_standardize', '训练内标准化'],
  ['alpha', '正则强度'],
  ['l1_ratio', 'L1 占比'],
  ['c_value', '惩罚 C'],
  ['epsilon', '容忍 ε'],
  ['n_estimators', '基学习器数'],
  ['max_depth', '最大树深'],
  ['learning_rate', '提升学习率'],
  ['n_neighbors', '近邻数'],
  ['kernel', '核函数'],
  ['hidden_layers', '隐藏层宽度'],
  ['class_weight', '类别权重'],
]
function supervisedParameters(
  context: FormulaContext,
  algorithm: string,
): readonly (readonly [string, string])[] {
  const usesBrand = ['xgboost', 'lightgbm', 'catboost'].includes(algorithm)
  if (usesBrand && context.schema)
    return fieldsOf(context.schema).map((field): readonly [string, string] => [
      field.key,
      field.label,
    ])
  return PARAMETERS.filter(
    ([key]) => key === 'algorithm' || context.config[key] !== undefined,
  )
}

function supervised(
  context: FormulaContext,
  task: 'regression' | 'classification',
) {
  const algorithm =
    textAt(context.config, 'algorithm') || hyperAt(context.ports, 'algorithm')
  const rule = (task === 'regression' ? REGRESSION : CLASSIFICATION)[algorithm]
  const parameters = supervisedParameters(context, algorithm)
  return tableExplanation(context, {
    id: 'algorithm',
    title: rule
      ? `${rule.title}的学习与预测口径`
      : '所选监督算法的学习与预测口径',
    expressions: [rule?.expression ?? '选择算法后显示对应的目标与预测方法'],
    parameters,
    notes: [
      rule?.note ?? '本次运行未记录可识别的算法，不能替换为另一种模型公式。',
      '模型内标准化开启且适用于该算法时，只在训练集拟合均值和尺度，并将变换与模型一同冻结；测试与部署不重新拟合。',
      task === 'classification'
        ? '原始数值类别保持不变；仅二分类且算法具备真实概率接口时提供正类概率，其余情况概率列为空。'
        : '在独立测试集上输出真实值和预测值；此处只解释算法，不代造二进制模型内的系数。',
      '实际参数以冻结配置和模型超参为准；隐藏的其他算法参数不参与当前估计器。',
    ],
  })
}
export const SUPERVISED_FORMULAS = {
  regression_model: [
    (context: FormulaContext) => supervised(context, 'regression'),
  ],
  classification_model: [
    (context: FormulaContext) => supervised(context, 'classification'),
  ],
}
