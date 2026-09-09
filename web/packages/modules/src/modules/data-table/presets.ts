/**
 * @fileoverview data-table 的四套配置预设：密集矩阵、台账清单、大屏看板、前 N 名。
 *
 * ⚠ 每套都把观感键写全，且顺序与 `configSchema` 的书写序一致。应用预设是**浅合并**：
 * 少写一个键，上一套留在 configJson 里的那个值就原样残留，而点亮判定做的是子集比较、
 * 照样把按钮点亮——既错了又没有任何提示。
 * ⚠ `precision` 刻意不写：它是数据精度，一套观感不能覆盖用户配置的数值口径。
 * `grouping` 是千分位观感，每套都显式写全，避免切换后残留上一套取值。
 * ⚠ 「前十行」会改变实际可见行数，属性面板会在提示中明确说明内容
 * 覆盖风险。`title` / `nameHeader` / `columns` / `rows` / `emptyText` / `rules`
 * 不由预设修改。
 */
import type { ConfigPreset } from '@dt/contracts'

export const DATA_TABLE_PRESETS: ConfigPreset[] = [
  {
    id: 'dense-matrix',
    label: '密集矩阵',
    hint: '使用紧凑行高、斑马纹与固定表头，适合在中等尺寸模块中展示多设备、多列数据。',
    config: {
      grouping: false,
      density: 'compact',
      striped: true,
      showHeader: true,
      headerSticky: true,
      gridLines: 'horizontal',
      maxRows: 0,
      headSize: 11,
      nameSize: 12,
      valueSize: 13,
      nameTone: 'secondary',
      valueColor: '',
    },
  },
  {
    id: 'ledger',
    label: '台账清单',
    hint: '使用标准行高与横纵网格线，适合逐列读取数据；通过网格线区分单元格，不使用斑马纹。',
    config: {
      grouping: false,
      density: 'normal',
      striped: false,
      showHeader: true,
      headerSticky: true,
      gridLines: 'both',
      maxRows: 0,
      headSize: 12,
      nameSize: 13,
      valueSize: 14,
      nameTone: 'primary',
      valueColor: '',
    },
  },
  {
    id: 'wall-board',
    label: '大屏看板',
    hint: '使用宽松行高与大号读数，并隐藏网格线，适合远距离查看少量数据。',
    config: {
      grouping: false,
      density: 'loose',
      striped: true,
      showHeader: true,
      headerSticky: false,
      gridLines: 'none',
      maxRows: 0,
      headSize: 14,
      nameSize: 16,
      valueSize: 20,
      nameTone: 'title',
      valueColor: '',
    },
  },
  {
    id: 'top-ten',
    label: '前十行',
    hint: '使用紧凑布局并仅显示前 10 行；其余行不参与渲染，仅在表格下方显示截断说明。',
    config: {
      grouping: false,
      density: 'compact',
      striped: true,
      showHeader: true,
      headerSticky: true,
      gridLines: 'horizontal',
      maxRows: 10,
      headSize: 11,
      nameSize: 12,
      valueSize: 13,
      nameTone: 'secondary',
      valueColor: '',
    },
  },
]
