import type { Effects } from '../types';
export interface EffectPreset {
  id: string;
  name: string;
  category: string;
  description: string;
  swatch: string;
  values: Partial<Effects>;
}
export const effectPresets: EffectPreset[] = [
  {
    id: 'clean',
    name: '清透',
    category: '调色',
    description: '明亮通透的日常画面',
    swatch: '#94c8b8',
    values: { brightness: 1.08, contrast: 1.05, saturation: 1.08 },
  },
  {
    id: 'cinema',
    name: '电影青橙',
    category: '调色',
    description: '暖色调与柔和暗角',
    swatch: '#b58d61',
    values: { contrast: 1.18, saturation: 0.82, sepia: 0.22, vignette: 0.35 },
  },
  {
    id: 'film',
    name: '复古胶片',
    category: '调色',
    description: '褪色暖调，柔和对比',
    swatch: '#c79c72',
    values: { sepia: 0.48, contrast: 0.9, saturation: 0.78, brightness: 1.07 },
  },
  {
    id: 'mono',
    name: '经典黑白',
    category: '调色',
    description: '黑白画面与更深的对比',
    swatch: '#a5acac',
    values: { grayscale: 1, contrast: 1.2 },
  },
  {
    id: 'cold',
    name: '冷调夜色',
    category: '调色',
    description: '降低饱和度，偏移色相',
    swatch: '#658aaf',
    values: { hue: 15, saturation: 0.72, brightness: 0.92, contrast: 1.12 },
  },
  {
    id: 'warm',
    name: '落日暖光',
    category: '调色',
    description: '温暖明亮的金色氛围',
    swatch: '#d99a54',
    values: { sepia: 0.3, saturation: 1.3, brightness: 1.05 },
  },
  {
    id: 'pop',
    name: '鲜明',
    category: '调色',
    description: '高饱和与鲜明对比',
    swatch: '#c17485',
    values: { saturation: 1.6, contrast: 1.12 },
  },
  {
    id: 'soft',
    name: '柔焦',
    category: '画面',
    description: '轻微模糊并提亮画面',
    swatch: '#a4ada8',
    values: { blur: 2, brightness: 1.08, contrast: 0.9 },
  },
  {
    id: 'blur',
    name: '高斯模糊',
    category: '画面',
    description: '模糊当前图层，支持蒙版',
    swatch: '#8d999c',
    values: { blur: 12 },
  },
  {
    id: 'pixel',
    name: '像素化',
    category: '画面',
    description: '可调强度的马赛克效果',
    swatch: '#818795',
    values: { pixelate: 16 },
  },
  {
    id: 'vignette',
    name: '暗角',
    category: '画面',
    description: '聚焦中央主体',
    swatch: '#55615c',
    values: { vignette: 0.65 },
  },
  {
    id: 'green',
    name: '绿幕抠像',
    category: '抠像',
    description: '移除绿色背景，可调容差',
    swatch: '#68ad77',
    values: { chroma: true, chromaColor: '#00ff00', chromaThreshold: 100 },
  },
  {
    id: 'blue',
    name: '蓝幕抠像',
    category: '抠像',
    description: '移除蓝色背景，可调容差',
    swatch: '#657fc0',
    values: { chroma: true, chromaColor: '#0000ff', chromaThreshold: 100 },
  },
  {
    id: 'circle',
    name: '圆形蒙版',
    category: '蒙版',
    description: '将当前图层裁为圆形',
    swatch: '#92aaa2',
    values: { mask: 'circle', maskSize: 0.9 },
  },
  {
    id: 'rect',
    name: '矩形蒙版',
    category: '蒙版',
    description: '可调大小的矩形裁切',
    swatch: '#b9a281',
    values: { mask: 'rectangle', maskSize: 0.7 },
  },
  {
    id: 'mirror',
    name: '水平镜像',
    category: '画面',
    description: '水平翻转当前图层',
    swatch: '#91a8b8',
    values: { flipX: true },
  },
];
