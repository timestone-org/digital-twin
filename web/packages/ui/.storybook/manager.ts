/**
 * @fileoverview Storybook 外壳的皮肤。组件库本身是深色工业风，外壳跟着深色，
 * 免得侧栏亮白、画布深蓝，两边的对比度判断互相干扰。
 */
import { addons } from 'storybook/manager-api'
import { themes } from 'storybook/theming'

addons.setConfig({ theme: themes.dark })
