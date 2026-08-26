/**
 * [阶段 P7] shared/media-reference — 媒体引用贡献者契约（纯类型）
 * [职责] MediaReferenceContributor 注册表机制的类型定义（P7 §3.4 签名逐字，
 *   字段名不得更改）。注册方：posts / collections / albums（P7）+ articles（P8）；
 *   消费方：media（删除前聚合检查，有引用 → 409 + 明细）。
 * [状态] ACTIVE
 *
 * shared 只放类型：注册表宿主在 apps/server/src/common/registry/（L0）。
 */

/** 单条媒体引用 */
export interface MediaReference {
  /** 'post-cover' | 'diary-image' | 'project-image' | 'device-image' | 'album-cover' | ... */
  refType: string;
  /** 人类可读引用方标识（文章 slug / 条目 id / 相册名） */
  targetLabel: string;
  /** 被引用的媒体相对路径（相对 Mizuki 根） */
  mediaPath: string;
}

/** 媒体引用贡献者（各内容模块自注册，media 删除前聚合反查） */
export interface MediaReferenceContributor {
  /** 模块名：'posts' | 'collections' | 'albums' | 'articles'（唯一） */
  readonly name: string;
  /** 聚合本模块对媒体的全部引用（只读扫描；失败由注册表内部捕获，不冒泡） */
  collectReferences(): Promise<MediaReference[]>;
}
