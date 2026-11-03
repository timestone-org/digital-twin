/** @fileoverview 固定文本、数值函数、替换与列间运算的公式和错误策略。 */
import type { FormulaContext } from './formulaArgs'
import { textAt } from './formulaArgs'
import { tableExplanation } from './formulaTabularArgs'

function invalidNote(context: FormulaContext, scope: string): string {
  const policy = textAt(context.config, 'on_invalid')
  return policy === 'error'
    ? `${scope}时整步报错，不交付部分结果。`
    : policy === 'null'
      ? `${scope}时该格留空，不以零替代。`
      : `${scope}时按配置选择整步报错或该格留空。`
}
function textTransform(context: FormulaContext) {
  const method = textAt(context.config, 'method')
  const expressions: Record<string, string> = {
    strip: 'y = strip(x)',
    lower: 'y = lower(x)',
    upper: 'y = upper(x)',
    replace: 'y = replace_literal(x, find, replacement)',
    prefix: 'y = replacement 后接 x',
    suffix: 'y = x 后接 replacement',
    length: 'y = len(x)',
  }
  const parameters: [string, string][] = [
    ['columns', '文本列'],
    ['method', '处理方式'],
  ]
  if (method === 'replace') parameters.push(['find', '查找文本'])
  if (['replace', 'prefix', 'suffix'].includes(method))
    parameters.push(['replacement', '替换或追加文本'])
  return tableExplanation(context, {
    id: 'text',
    title: '每个文本值如何处理',
    expressions: [expressions[method] ?? 'y = 所选固定文本操作(x)'],
    parameters,
    legend: [{ symbol: 'x / y', text: '处理前后的单格值；直接更新原列' }],
    notes: [
      '替换使用固定文本匹配并替换全部命中，不解释正则或自由表达式；空替换文本表示删除命中文本。',
      '长度是 Python Unicode 码点数量，不是字节数或可见字形数；长度模式把原列变为无单位数值。',
      '空值保持为空；未选列时处理全部文本列。',
    ],
  })
}
function numericTransform(context: FormulaContext) {
  const method = textAt(context.config, 'method')
  const expressions: Record<string, string> = {
    abs: 'y = |x|',
    log: 'y = ln(x)',
    log1p: 'y = ln(1 + x)',
    sqrt: 'y = sqrt(x)',
    square: 'y = x²',
    exp: 'y = exp(x)',
    round: 'y = round(x, d)',
    affine: 'y = a·x + b',
  }
  const parameters: [string, string][] = [
    ['columns', '数值列'],
    ['method', '处理方式'],
    ['on_invalid', '错误策略'],
  ]
  if (method === 'affine')
    parameters.push(['factor', '乘数 a'], ['offset', '加数 b'])
  if (method === 'round') parameters.push(['digits', '小数位 d'])
  return tableExplanation(context, {
    id: 'numeric',
    title: '固定数学变换及定义域',
    expressions: [expressions[method] ?? 'y = f_method(x)'],
    parameters,
    legend: [
      { symbol: 'x / y', text: '处理前后的数值，直接更新原列；空值不计算' },
    ],
    notes: [
      'log 是自然对数，要求 x > 0；log1p 要求 x > −1；sqrt 要求 x ≥ 0。',
      'round 使用 Python 的最接近值舍入，正好居中时取偶数；二进制浮点表示可能影响十进制临界值。负小数位向十位、百位等舍入。',
      invalidNote(context, '定义域错误或数值溢出'),
      '不选列时处理非目标数值列；abs、round、affine 保留单位，其余变换清除单位。',
    ],
  })
}
function replaceValues(context: FormulaContext) {
  const fill = context.config['should_include_missing']
  return tableExplanation(context, {
    id: 'replace',
    title: '精确匹配哪些值并替换',
    expressions: [
      'y = replacement 若 x = match',
      '其他值保持不变；空值由显式开关决定',
    ],
    parameters: [
      ['columns', '数值列'],
      ['match', '匹配值'],
      ['replacement', '替换值'],
      ['should_include_missing', '填充空值'],
    ],
    legend: [{ symbol: 'match', text: '精确相等的数值，不使用近似容差' }],
    notes: [
      fill === true
        ? '已明确开启同时填充空值，缺失格也写入替换值。'
        : fill === false
          ? '未开启空值填充，空值保持为空。'
          : '空值只有在明确开启填充后才修改，不自动当作零。',
      '直接更新所选数值列；未选择时处理全部非目标数值列。',
    ],
  })
}
function columnMath(context: FormulaContext) {
  const method = textAt(context.config, 'method')
  const mode = textAt(context.config, 'right_mode')
  const expressions: Record<string, string> = {
    add: 'y = a + b',
    subtract: 'y = a − b',
    multiply: 'y = a·b',
    divide: 'y = a / b',
    min: 'y = min(a, b)',
    max: 'y = max(a, b)',
  }
  return tableExplanation(context, {
    id: 'arithmetic',
    title: '左右两端的取值与固定运算',
    expressions: [expressions[method] ?? 'y = 固定运算(a, b)'],
    parameters: [
      ['left_column', '左侧数值列'],
      ['right_mode', '右侧来源'],
      [mode === 'column' ? 'right_column' : 'constant', '右侧取值'],
      ['method', '运算'],
      ['output_column', '新增输出列'],
      ['on_invalid', '错误策略'],
    ],
    legend: [
      { symbol: 'a', text: '左侧数值列的当前值' },
      {
        symbol: 'b',
        text:
          mode === 'column'
            ? '右侧数值列同一行的值'
            : mode === 'constant'
              ? '配置中固定常数'
              : '按配置取另一列或常数',
      },
    ],
    notes: [
      mode === 'column'
        ? '右侧来自右侧数值列，逐行对应。'
        : mode === 'constant'
          ? '右侧使用同一个固定常数。'
          : '右侧来源由配置决定。',
      '任一输入为空则输出为空；生成新列，不覆盖已有列，不执行自由表达式。',
      invalidNote(context, '除零或数值溢出'),
    ],
  })
}
export const VALUE_FORMULAS = {
  text_transform: [textTransform],
  numeric_transform: [numericTransform],
  replace_values: [replaceValues],
  column_math: [columnMath],
}
