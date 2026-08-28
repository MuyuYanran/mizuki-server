> 快照说明：抓取自 https://docs.mizuki.mysqil.com/special/devices/ ，快照日期 2026-08-28，文档日期 2025-11-20。仅供 B4 审计引用。

# 设备页面

## 1. 核心概念：页面与数据分离

- 展示逻辑：`src/pages/devices.astro`
- 内容数据：`src/data/devices.ts` —— 设备数据以**对象**形式存储；每一个设备都是一个对象，包含 `name`, `image`, `specs`, `description`, `link` 等属性。

## 2. `src/data/devices.ts` 文件详解

```ts
export interface Device {
  name: string;
  image: string;
  specs: string;
  description: string;
  link: string;
}

export type DeviceCategory = {
  [categoryName: string]: Device[];
} & {
  自定义?: Device[];
};

export const devicesData: DeviceCategory = {
  OnePlus: [
    {
      name: "OnePlus 13T",
      image: "/images/device/oneplus13t.png",
      specs: "Gray / 16G + 1TB",
      description: "Flagship performance, Hasselblad imaging, 80W SuperVOOC.",
      link: "https://www.oneplus.com/cn/13t",
    },
  ],
  Router: [
    {
      name: "GL-MT3000",
      image: "/images/device/mt3000.png",
      specs: "1000Mbps / 2.5G",
      description: "Portable WiFi 6 router suitable for business trips and home use.",
      link: "https://www.gl-inet.cn/products/gl-mt3000/",
    },
  ],
};
```

**数据结构说明**：

- `interface Device`（每一设备必填字段全部为 string）：
  - `name: string`: (必填) 设备名称。
  - `image: string`: (必填) 设备图片路径，通常放在 `public/images/device/` 目录下。
  - `specs: string`: (必填) 主要规格参数。
  - `description: string`: (必填) 简短描述。
  - `link: string`: (必填) 官方链接或购买链接。
- `DeviceCategory`：键名是分类名称（如 "OnePlus"、"Router"），值是该分类下的设备数组；可有 "自定义" 分类。
- 分类显示顺序按对象属性顺序。

## 5. 设备分类说明

品牌分类（"OnePlus"、"Apple"、"Lenovo"）；类型分类（"Router"、"Notebook"、"Phone"、"Tablet"）；"自定义" 分类放不属于其他分类的设备。

## 6. 最佳实践与建议

设备图片统一风格高质量；规格简明；描述准确；链接有效；分类合理。

---

版权归属：LyraVoid Team ｜ 许可证：CC-BY-4.0 ｜ 最后更新于: 4/21/26, 10:12 PM
