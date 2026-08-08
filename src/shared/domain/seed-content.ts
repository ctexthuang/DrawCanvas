import type {
  GeneratedArtwork,
  PromptAsset,
  ResourceCatalog,
  WorkflowAsset,
} from '../contracts/desktop'

export const seedArtworks: ReadonlyArray<GeneratedArtwork> = [
  { id: '1', title: '霓虹雨夜', prompt: '电影感的未来都市雨夜，霓虹倒影，独自行走的人物，宽银幕构图', model: 'Seedream 5.0 Pro', size: '2048 × 2048', createdAt: '今天 12:34', palette: 'linear-gradient(145deg, #11202d 0%, #1d2555 35%, #fd5476 70%, #ff9f68 100%)', tags: ['电影感', '都市'] },
  { id: '2', title: '蓝色梦境', prompt: '漂浮在深蓝海洋上方的透明水母宫殿，柔和体积光，超现实摄影', model: 'Gemini 3 Pro Image', size: '1536 × 2048', createdAt: '今天 11:08', palette: 'radial-gradient(circle at 40% 35%, #9deaff 0 8%, #2869b7 22%, #0b1c46 55%, #030914 100%)', tags: ['梦境', '蓝色'] },
  { id: '3', title: '静物研究', prompt: '极简主义静物摄影，磨砂玻璃花瓶与白色花朵，奶油色背景，自然侧光', model: 'GPT Image 2', size: '2048 × 2048', createdAt: '昨天 23:41', palette: 'linear-gradient(125deg, #ebe3d7 0%, #c9b6a5 45%, #faf5ed 46%, #969b78 100%)', tags: ['静物', '极简'] },
  { id: '4', title: '机械花园', prompt: '复古机械结构与野生植物交织的温室，黄铜细节，清晨薄雾', model: 'Seedream 5.0 Pro', size: '2048 × 1536', createdAt: '昨天 19:16', palette: 'linear-gradient(155deg, #20342b 0%, #64785b 42%, #d19b57 66%, #392d27 100%)', tags: ['机械', '自然'] },
  { id: '5', title: '纸艺建筑', prompt: '由折纸构成的现代美术馆，白色与荧光绿色纸张，清晰硬阴影', model: 'Gemini 2.5 Flash Image', size: '2048 × 2048', createdAt: '8月6日 15:32', palette: 'linear-gradient(135deg, #f3f4ee 0 38%, #aaff00 39% 53%, #313b34 54% 70%, #d9ded4 71%)', tags: ['建筑', '纸艺'] },
  { id: '6', title: '暮色山谷', prompt: '日落之后的高山峡谷，紫色薄雾与蜿蜒河流，细腻风景概念艺术', model: 'GPT Image 2', size: '2048 × 1536', createdAt: '8月5日 21:09', palette: 'linear-gradient(165deg, #f39d78 0%, #70577e 34%, #273c4d 58%, #17251e 72%, #7ba789 100%)', tags: ['风景', '概念艺术'] },
  { id: '7', title: '液态字符', prompt: '流动金属形成的抽象汉字，黑色背景，棚拍高光，先锋海报设计', model: 'Seedream 5.0 Pro', size: '1536 × 2048', createdAt: '8月5日 14:22', palette: 'radial-gradient(ellipse at 52% 42%, #f4f4e8 0 8%, #a2b3af 9% 22%, #333942 23% 44%, #07080a 45% 100%)', tags: ['抽象', '海报'] },
  { id: '8', title: '早餐时刻', prompt: '阳光照进木质餐桌，手工陶器与可颂，温暖生活方式摄影', model: 'Gemini 3 Pro Image', size: '2048 × 2048', createdAt: '8月4日 09:12', palette: 'linear-gradient(145deg, #fff0c4 0%, #d6a96e 34%, #784e30 65%, #e0c795 100%)', tags: ['生活', '暖色'] },
]

export const seedPrompts: ReadonlyArray<PromptAsset> = [
  { id: 'p1', title: '电影感城市夜景', category: '摄影', body: '电影感的未来都市雨夜，霓虹招牌在湿润路面形成倒影，35mm 镜头，低机位，轻微薄雾，高反差光影，宽银幕构图。' },
  { id: 'p2', title: '电商产品棚拍', category: '商业', body: '高级产品摄影，主体置于几何底座，柔光箱从左上方照明，纯净渐变背景，边缘轮廓光，真实材质与细腻阴影。' },
  { id: 'p3', title: '角色设定三视图', category: '角色', body: '完整角色设定表，正面、侧面、背面三视图，统一比例，中性站姿，服装结构与配件细节清晰，纯色背景。' },
  { id: 'p4', title: '极简建筑模型', category: '建筑', body: '极简现代建筑模型，白色纸质材质，荧光绿色局部点缀，45 度轴测视角，强烈阳光与锐利阴影，杂志排版质感。' },
]

export const seedWorkflows: ReadonlyArray<WorkflowAsset> = [
  { id: 'w1', title: '概念图快速迭代', description: '提示词扩写 → 四图生成 → 高清放大 → 自动收藏', nodes: 4, accent: '#aaff00' },
  { id: 'w2', title: '商品海报生产线', description: '商品抠图 → 场景合成 → 标题排版 → 多尺寸导出', nodes: 6, accent: '#8b5cf6' },
  { id: 'w3', title: '角色表情拓展', description: '读取角色 → 提取特征 → 九种表情 → 拼图导出', nodes: 5, accent: '#f97316' },
]

export const seedResourceCatalog: ResourceCatalog = {
  prompts: seedPrompts,
  workflows: seedWorkflows,
}
