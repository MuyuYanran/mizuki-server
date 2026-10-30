/**
 * [U4-AI3/B] AI meta 回填目标注册（编辑器 ⇄ 聊天栏）
 *
 * [为什么沿用「注册」而不是 props 逐层传]
 *   与 `lib/ai/context.ts` 同一理由：聊天栏挂在 `MainLayout`，编辑页在 `router-view`
 *   深处，两者不是父子。
 *
 * [最关键的一条：本模块**只提供通道，不做写入**]
 *   真正写入必须由**用户在聊天栏的回填卡片上确认后**触发（见 AiChatDrawer 的 meta 卡片）。
 *   本模块的 `apply` 只接受**已被用户勾选的字段**——
 *   「绝不静默覆盖用户已写内容」这条铁律由两层共同保证：
 *     ① `planMetaBackfill()`（shared 纯函数）算出四态，界面据此显示差异；
 *     ② 界面对 `conflict` 项**默认不勾选**，用户必须主动勾才覆盖。
 *
 * [注销语义] 与 context 注册同款：只有「自己仍是当前」才清空，
 *   防止快速切换编辑页时旧页面的 unmount 把新页面的注册抹掉。
 */
import { ref } from 'vue';

/** 编辑器暴露给回填通道的最小接口 */
export interface AiMetaTarget {
  /** 读当前表单值（供 shared 的 planMetaBackfill 比对，判定 fill/conflict） */
  read: () => { title: string; summary: string; tags: string[] };
  /**
   * 应用**用户已勾选**的字段。
   * 未出现在 patch 里的字段一律不动（这不是「部分更新」，是「只改这些」）。
   */
  apply: (patch: { title?: string; summary?: string; tags?: string[] }) => void;
  /** 目标字段的中文标签（界面提示「将回填到：标题 / 摘要 / 标签」） */
  describe: () => string;
}

/** 当前活动的回填目标（null = 当前页面不支持回填） */
export const activeMetaTarget = ref<AiMetaTarget | null>(null);

/**
 * 注册回填目标，返回**注销函数**。
 * 注销时只有「自己仍是当前」才清空（同 context 注册的竞态处理）。
 */
export function registerMetaTarget(target: AiMetaTarget): () => void {
  activeMetaTarget.value = target;
  return () => {
    if (activeMetaTarget.value === target) {
      activeMetaTarget.value = null;
    }
  };
}
