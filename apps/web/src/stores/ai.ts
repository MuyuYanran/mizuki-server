/**
 * [U4-AI2] AI 面板状态（模块级 ref 导出 —— 本仓无 Pinia，照 `stores/system.ts` 的写法）
 *
 * 三个边界（指令包 §4.1 逐字）：
 * - **配置缓存**：`aiConfig` 只在打开抽屉/进入设置页时拉，改动后立即回写；
 * - **会话只在内存**：`aiMessages` **绝不写 localStorage**（内容含文章正文）；
 *   刷新即清空是特性不是缺陷；
 * - **只持久化 UI 偏好**：抽屉开合与宽度（宽度在组件里用 useSplitter 自己管）。
 */
import { ref } from 'vue';
import type { AiAction, AiConfigView, MetaBackfillPlan, ParsedMeta } from '@mizuki/shared';
import { aiApi } from '../api/ai';

/** 抽屉开合的持久化键（只存 '1' / '0'） */
const DRAWER_OPEN_KEY = 'mizuki.ui.aiDrawer.open';

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** 该条由哪个动作产生（自由对话为 undefined） */
  action?: AiAction;
  /** 错误文案（该条渲染成错误样式，且不参与后续上下文） */
  error?: string;
  /** 供「替换选区/插入」使用：本条是否已经插入过（避免误重复插入） */
  inserted?: boolean;
  /**
   * [U4-AI3/B] `meta` 动作：解析结果与回填计划。
   * 只在流结束、且当前页面注册了回填目标时才有值 ——
   * 没有目标时不必解析（解析出来也无处可填，徒增界面噪音）。
   */
  meta?: { parsed: ParsedMeta; plan: MetaBackfillPlan };
  /** 回填是否已应用（应用后卡片转为只读态，避免重复点击） */
  metaApplied?: boolean;
}

/** 服务端配置视图（null = 未加载） */
export const aiConfig = ref<AiConfigView | null>(null);
/** 配置加载中（首次打开抽屉时的骨架态） */
export const aiConfigLoading = ref(false);
/** 最近一次配置加载失败的原因（抽屉里降级展示，不阻塞聊天） */
export const aiConfigError = ref<string | null>(null);

/** 抽屉是否展开（持久化） */
export const aiDrawerOpen = ref<boolean>(readStoredOpen());

/** 会话消息（仅内存） */
export const aiMessages = ref<AiMessage[]>([]);

/** 流式中（同一时刻只允许一条流：按钮变「中止」） */
export const aiStreaming = ref(false);

/** 递增 id（nanoid 未在 web 侧引入，用轻量计数器 + 时间戳足够） */
let messageSeq = 0;
export function nextMessageId(): string {
  messageSeq += 1;
  return `m${Date.now().toString(36)}-${messageSeq}`;
}

function readStoredOpen(): boolean {
  try {
    return localStorage.getItem(DRAWER_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** 设置抽屉开合（同时持久化；storage 异常不影响使用） */
export function setDrawerOpen(open: boolean): void {
  aiDrawerOpen.value = open;
  try {
    localStorage.setItem(DRAWER_OPEN_KEY, open ? '1' : '0');
  } catch {
    // 容错：隐私模式等场景写不进去，UI 状态仍然生效
  }
}

export function toggleDrawer(): void {
  setDrawerOpen(!aiDrawerOpen.value);
}

/**
 * 拉取配置（幂等；`force=true` 时强制刷新）。
 * 失败**不抛**：只记录 `aiConfigError`，让抽屉显示引导而不是崩掉整页。
 */
export async function ensureAiConfig(force = false): Promise<void> {
  if (!force && (aiConfig.value !== null || aiConfigLoading.value)) {
    return;
  }
  aiConfigLoading.value = true;
  aiConfigError.value = null;
  try {
    aiConfig.value = await aiApi.getConfig();
  } catch (error) {
    aiConfigError.value = error instanceof Error ? error.message : '配置加载失败';
  } finally {
    aiConfigLoading.value = false;
  }
}

/** 配置就绪且可发送：启用 + 有当前档案 */
export function isAiReady(config: AiConfigView | null): boolean {
  if (config === null || !config.enabled) return false;
  if (config.activeProfileId === null) return false;
  return config.profiles.some((profile) => profile.id === config.activeProfileId);
}

/** 当前档案（用于抽屉标题显示「档案名 · 模型」） */
export function activeProfile(config: AiConfigView | null) {
  if (config === null || config.activeProfileId === null) return null;
  return config.profiles.find((profile) => profile.id === config.activeProfileId) ?? null;
}

/** 清空会话（也用于「离开编辑页」时避免上下文串味 —— 见 AiChatDrawer 的上下文条逻辑） */
export function clearMessages(): void {
  aiMessages.value = [];
}

/** 追加一条消息并返回它（返回引用，便于流式期间原地累加内容） */
export function pushMessage(input: Omit<AiMessage, 'id'>): AiMessage {
  const message: AiMessage = { id: nextMessageId(), ...input };
  aiMessages.value.push(message);
  return message;
}

/**
 * 供流式回调原地累加：`ref` 内的对象是响应式的，
 * 直接改 `content` 会触发渲染（不要在流式里整体替换数组，会丢滚动位置）。
 */
export function appendToMessage(message: AiMessage, text: string): void {
  message.content += text;
}
