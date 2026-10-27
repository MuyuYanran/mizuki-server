<script setup lang="ts">
/**
 * [U4-AI2] 全局右侧 AI 助手（悬浮抽屉形态）
 *
 * 形态参照火山方舟控制台的「火山助手」：
 * ① **收起态**：贴右边缘一枚竖排把手（图标 + 竖排文字），始终可见，点击展开；
 * ② **展开态**：浮岛卡片 —— 四周留白、圆角 16px、投影浮起，**不挤压正文**（覆盖式）；
 * ③ 开合走 CSS 位移过渡（`translateX`），不是 v-if 卸载 ⇒ **收起不会中断正在进行的流式回复**；
 * ④ 左边缘可拖宽（320–640，宽度持久化）。
 *
 * 四条硬纪律（不变）：
 * - AI 输出只用文本插值渲染（禁 `v-html`）；
 * - 永不自动写编辑器（三键人工触发）；
 * - 会话只在内存（含正文，刷新即清是特性）；
 * - 上下文惰性获取（不在打字路径同步全文）。
 */
import { computed, nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { AI_ACTION_LABELS, AI_ACTIONS, AI_LIMITS, truncateForContext, type AiAction } from '@mizuki/shared';
import { useSplitter } from '../lib/float/use-splitter';
import { aiApi } from '../api/ai';
import {
  activeProfile,
  aiConfig,
  aiConfigError,
  aiDrawerOpen,
  aiMessages,
  aiStreaming,
  appendToMessage,
  ensureAiConfig,
  isAiReady,
  pushMessage,
  setDrawerOpen,
  toggleDrawer,
  clearMessages,
  type AiMessage,
} from '../stores/ai';
import { activeAiContext, describeActiveContext } from '../lib/ai/context';
import { AI_ACTION_HINTS, AI_CHAT_PLACEHOLDER } from '../lib/ai/actions';

const router = useRouter();

// ── 宽度（拖拽 + 持久化；上限用 CSS 再兜一层视口约束） ──────────────
const { width: panelWidth, isDragging, onPointerDown } = useSplitter({
  storageKey: 'mizuki.layout.ai-drawer.v1',
  defaultWidth: 380,
  min: 320,
  max: 640,
});

// ── 状态派生 ────────────────────────────────────────────────────────
const ready = computed(() => isAiReady(aiConfig.value));
const currentProfile = computed(() => activeProfile(aiConfig.value));
const contextInfo = computed(() => describeActiveContext());
const hasContext = computed(() => contextInfo.value !== null);
const hasSelection = computed(() => contextInfo.value?.hasSelection === true);
const hasMessages = computed(() => aiMessages.value.length > 0);

/** 发送禁用原因（null = 可发送）；文案直接展示，避免"按钮灰了不知道为什么" */
const blockedReason = computed<string | null>(() => {
  // [竞态修复] 配置还没拉到（首次挂载/刷新瞬间）→ 不要谎报"未配置"，
  // 否则用户会看到一闪而过的「去配置」而被误导去重配一遍。
  if (aiConfig.value === null) return null;
  if (!aiConfig.value.enabled) return 'AI 功能未启用';
  if (aiConfig.value.activeProfileId === null) return '未选择服务档案';
  if (!ready.value) return '当前档案不可用';
  return null;
});

/** 真正「配置读取失败」时的提示（与"未配置"区分：前者可重试，后者要去设置页） */
const configFailed = computed(() => aiConfig.value === null && aiConfigError.value !== null);

/** 可发送：配置就绪 + 可用 + 无流式（不能只看 blockedReason，加载中它也是 null） */
const canSend = computed(() => ready.value && blockedReason.value === null && !aiStreaming.value);
const lastAssistant = computed<AiMessage | null>(() => {
  for (let i = aiMessages.value.length - 1; i >= 0; i -= 1) {
    const message = aiMessages.value[i];
    if (message !== undefined && message.role === 'assistant' && message.error === undefined) {
      return message;
    }
  }
  return null;
});
const canInsert = computed(() => lastAssistant.value !== null && hasContext.value);

const input = ref('');
const listRef = ref<HTMLElement | null>(null);
let abortStream: (() => void) | null = null;

// ── 滚动 ────────────────────────────────────────────────────────────
async function scrollToBottom(): Promise<void> {
  await nextTick();
  const el = listRef.value;
  if (el !== null) el.scrollTop = el.scrollHeight;
}
watch(() => aiMessages.value.length, () => void scrollToBottom());

// ── 展开时拉配置（幂等；失败降级为引导条） ────────────────────────
watch(
  aiDrawerOpen,
  (open) => {
    if (open) {
      void ensureAiConfig();
      void scrollToBottom();
    }
  },
  { immediate: true },
);

// ── 流式 ────────────────────────────────────────────────────────────
function buildContext():
  | { kind: 'selection' | 'article' | 'markdown'; text: string; truncated: boolean; originalChars: number }
  | undefined {
  const reg = activeAiContext.value;
  if (reg === null) return undefined;
  const raw = reg.getText();
  if (raw.trim() === '') return undefined;
  const slice = truncateForContext(raw, AI_LIMITS.maxContextChars);
  return {
    kind: reg.kind,
    text: slice.text,
    truncated: slice.truncated,
    originalChars: slice.originalChars,
  };
}

function runStream(body: { action?: AiAction; userText: string; echoUser: boolean }): void {
  if (aiStreaming.value) return;

  const context = buildContext();
  const assistant = pushMessage({
    role: 'assistant',
    content: '',
    ...(body.action !== undefined ? { action: body.action } : {}),
  });
  if (body.echoUser) {
    const userMessage = pushMessage({ role: 'user', content: body.userText });
    const list = aiMessages.value;
    const assistantIndex = list.indexOf(assistant);
    const userIndex = list.indexOf(userMessage);
    if (assistantIndex !== -1 && userIndex !== -1) {
      list.splice(userIndex, 1);
      list.splice(assistantIndex, 0, userMessage);
    }
  }

  aiStreaming.value = true;
  abortStream = aiApi.streamChat(
    {
      ...(body.action !== undefined ? { action: body.action } : {}),
      messages: [{ role: 'user', content: body.userText }],
      ...(context !== undefined ? { context: { kind: context.kind, text: context.text } } : {}),
    },
    {
      onDelta: (text) => {
        appendToMessage(assistant, text);
        void scrollToBottom();
      },
      onDone: () => {
        aiStreaming.value = false;
        abortStream = null;
        if (assistant.content.trim() === '') assistant.error = '模型没有返回内容。';
        void scrollToBottom();
      },
      onError: (error, aborted) => {
        aiStreaming.value = false;
        abortStream = null;
        if (aborted) {
          if (assistant.content.trim() === '') assistant.error = '已中止（未收到内容）。';
          return;
        }
        assistant.error = error.message;
        void scrollToBottom();
      },
    },
  );

  if (context !== undefined && context.truncated) {
    ElMessage.warning(
      `上下文已截断：送出 ${AI_LIMITS.maxContextChars} 字 / 原文 ${context.originalChars} 字`,
    );
  }
}

function runAction(action: AiAction): void {
  if (!canSend.value) return;
  runStream({ action, userText: AI_ACTION_HINTS[action], echoUser: false });
}

function send(): void {
  const text = input.value.trim();
  if (text === '' || !canSend.value) return;
  input.value = '';
  runStream({ userText: text, echoUser: true });
}

function stop(): void {
  abortStream?.();
  abortStream = null;
  aiStreaming.value = false;
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  send();
}

// ── 三键插入（永不自动） ────────────────────────────────────────
function insertToCursor(): void {
  const reg = activeAiContext.value;
  const message = lastAssistant.value;
  if (reg === null || message === null) return;
  reg.insertText(message.content);
  message.inserted = true;
}

function replaceSelection(): void {
  const reg = activeAiContext.value;
  const message = lastAssistant.value;
  if (reg === null || message === null) return;
  reg.replaceText(message.content);
  message.inserted = true;
}

async function copyOutput(): Promise<void> {
  const message = lastAssistant.value;
  if (message === null) return;
  try {
    await navigator.clipboard.writeText(message.content);
    ElMessage.success('已复制');
  } catch {
    ElMessage.error('复制失败（浏览器未授予剪贴板权限）');
  }
}

function gotoConfig(): void {
  void router.push('/settings/ai');
}

/** 收起（不中断流式：面板只是位移，组件不卸载） */
function collapse(): void {
  setDrawerOpen(false);
}
</script>

<template>
  <!-- 收起态：贴右边缘的竖排把手（始终可见的悬浮入口） -->
  <button
    v-show="!aiDrawerOpen"
    class="ai-rail"
    :title="`打开 AI 助手${currentProfile ? `（${currentProfile.model}）` : ''}`"
    @click="toggleDrawer"
  >
    <svg class="ai-rail-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3.5l1.9 4.4 4.6 1.7-4.6 1.7L12 15.7l-1.9-4.4L5.5 9.6l4.6-1.7Z" />
      <path d="M18.5 15.5l.8 1.9 2 .7-2 .7-.8 1.9-.8-1.9-2-.7 2-.7Z" />
    </svg>
    <span class="ai-rail-text">AI 助手</span>
    <span v-if="aiStreaming" class="ai-rail-dot" title="正在生成…"></span>
  </button>

  <!-- 展开态：浮岛卡片（覆盖式，不挤压正文）
       [可及性] 收起时用 v-bind 对象展开挂上 `inert`（不用 `:inert="bool"`）：
       该属性**存在即生效**，布尔绑定在 false 时可能渲染成 inert="false" 反而
       让收起后的面板仍可被 Tab/读屏进入。只在收起时才出现该属性最稳。 -->
  <aside
    :class="['ai-panel', { 'is-open': aiDrawerOpen, 'is-resizing': isDragging }]"
    :style="{ width: `${panelWidth}px` }"
    v-bind="aiDrawerOpen ? {} : { inert: true }"
    :aria-hidden="aiDrawerOpen ? undefined : true"
  >
    <!-- 左边缘拖宽手柄 -->
    <div class="ai-grip" title="拖动调整宽度" @pointerdown="onPointerDown" />

    <header class="ai-head">
      <div class="ai-head-main">
        <span class="ai-head-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3.5l1.9 4.4 4.6 1.7-4.6 1.7L12 15.7l-1.9-4.4L5.5 9.6l4.6-1.7Z" />
          </svg>
        </span>
        <span class="ai-title">AI 助手</span>
        <span v-if="currentProfile" class="ai-chip">{{ currentProfile.name }}</span>
      </div>
      <div class="ai-head-actions">
        <button class="ai-icon-btn" title="清空对话" :disabled="!hasMessages || aiStreaming" @click="clearMessages()">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13" />
          </svg>
        </button>
        <button class="ai-icon-btn" title="收起" @click="collapse">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </header>

    <!-- 上下文条 -->
    <div class="ai-context">
      <template v-if="contextInfo">
        <span class="ai-ctx-tag">{{ contextInfo.kind === 'selection' ? '选区' : '当前文档' }}</span>
        <span>{{ contextInfo.chars }} 字</span>
        <span v-if="contextInfo.hasSelection" class="ai-ctx-ok">有选区</span>
        <span v-else class="ai-ctx-dim">无选区</span>
      </template>
      <span v-else class="ai-ctx-dim">未挂载上下文 · 纯对话模式</span>
    </div>

    <!-- 未就绪：引导。区分「读配置失败（可重试）」与「未启用/未选档案（去设置页）」 -->
    <div v-if="configFailed" class="ai-blocked is-error">
      <span>配置读取失败：{{ aiConfigError }}</span>
      <el-button size="small" plain @click="ensureAiConfig(true)">重试</el-button>
    </div>
    <div v-else-if="blockedReason" class="ai-blocked">
      <span>{{ blockedReason }}</span>
      <el-button size="small" type="primary" plain @click="gotoConfig">去配置</el-button>
    </div>

    <!-- 消息区 -->
    <div ref="listRef" class="ai-messages">
      <!-- 空态：动作卡（参照火山「我能帮您做」）；有消息后换成顶部动作行 -->
      <template v-if="!hasMessages">
        <p class="ai-empty-title">我能帮你做什么</p>
        <div class="ai-cards">
          <button
            v-for="action in AI_ACTIONS"
            :key="action"
            class="ai-card"
            :disabled="!canSend || !hasContext"
            @click="runAction(action)"
          >
            <span class="ai-card-label">{{ AI_ACTION_LABELS[action] }}</span>
            <span class="ai-card-hint">{{ hasContext ? '基于当前文档' : '需先在编辑页打开' }}</span>
          </button>
        </div>
        <p class="ai-empty-hint">选中编辑器里的文字再用动作，或直接在下方提问。</p>
      </template>

      <!-- 有消息：顶部动作行（继续对同一文档操作） -->
      <div v-if="hasMessages" class="ai-actions">
        <button
          v-for="action in AI_ACTIONS"
          :key="action"
          class="ai-pill"
          :disabled="!canSend || !hasContext"
          @click="runAction(action)"
        >
          {{ AI_ACTION_LABELS[action] }}
        </button>
      </div>

      <div
        v-for="message in aiMessages"
        :key="message.id"
        :class="['ai-msg', `is-${message.role}`, { 'is-error': message.error !== undefined }]"
      >
        <div v-if="message.action" class="ai-msg-tag">{{ AI_ACTION_LABELS[message.action] }}</div>
        <!-- 禁 v-html：模型输出是不可信文本 -->
        <div class="ai-msg-body">{{ message.error ?? message.content }}</div>
        <span v-if="message.inserted" class="ai-msg-inserted">已插入</span>
      </div>
    </div>

    <!-- 三键（有输出且有上下文才可用） -->
    <div class="ai-insert">
      <button class="ai-pill" :disabled="!canInsert || !hasSelection" @click="replaceSelection">替换选区</button>
      <button class="ai-pill" :disabled="!canInsert" @click="insertToCursor">插入到光标</button>
      <button class="ai-pill" :disabled="lastAssistant === null" @click="copyOutput">复制</button>
    </div>

    <!-- 输入区 -->
    <div class="ai-input">
      <el-input
        v-model="input"
        type="textarea"
        :rows="2"
        resize="none"
        :placeholder="AI_CHAT_PLACEHOLDER"
        :disabled="!ready"
        @keydown="onKeydown"
      />
      <div class="ai-input-bar">
        <span class="ai-disclaimer">内容由 AI 生成，请自行核查</span>
        <div class="ai-input-btns">
          <button v-if="aiStreaming" class="ai-send is-stop" @click="stop">中止</button>
          <button v-else class="ai-send" :disabled="!canSend || input.trim() === ''" @click="send">发送</button>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
/* ── 收起态把手：贴右边缘，圆角朝内，悬浮在内容之上 ── */
.ai-rail {
  position: fixed;
  right: 0;
  top: 45%;
  z-index: 1900;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 7px;
  border: 1px solid var(--mizuki-soft-card-border);
  border-right: none;
  border-radius: 16px 0 0 16px;
  background: var(--el-bg-color);
  color: var(--el-color-primary);
  cursor: pointer;
  box-shadow: var(--el-box-shadow-light);
  transition: background 0.18s, color 0.18s, transform 0.18s;
}

.ai-rail:hover {
  background: var(--el-color-primary-light-9);
  transform: translateX(-2px);
}

.ai-rail-text {
  writing-mode: vertical-rl;
  letter-spacing: 2px;
  font-size: 12px;
  color: var(--el-text-color-regular);
}

.ai-rail-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--el-color-primary);
  animation: ai-pulse 1.2s ease-in-out infinite;
}

@keyframes ai-pulse {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}

/* ── 展开态：浮岛卡片（覆盖式，四周留白 + 圆角 + 投影） ── */
.ai-panel {
  position: fixed;
  top: 76px;
  right: 16px;
  bottom: 16px;
  z-index: 2000;
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-width: calc(100vw - 32px);
  border: 1px solid var(--mizuki-soft-card-border);
  border-radius: 20px;
  background: var(--el-bg-color);
  box-shadow: 0 12px 40px -8px var(--el-box-shadow-dark), var(--el-box-shadow-light);
  /* 位移过渡：收起时整体滑出，组件不卸载 ⇒ 流式不中断 */
  transform: translateX(calc(100% + 24px));
  opacity: 0;
  pointer-events: none;
  transition: transform 0.26s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease;
}

.ai-panel.is-open {
  transform: translateX(0);
  opacity: 1;
  pointer-events: auto;
}

/* 收起态：滑出 + 视觉隐藏，但**保留在 DOM**（流式不中断）。
   焦点与无障碍树由模板上的 `inert` 负责——只靠 opacity/pointer-events
   挡不住键盘用户 Tab 进不可见面板（本批修掉的真实缺陷）。
   不用 `visibility: hidden`：那会让收起动画瞬间消失。 */

/* 拖拽中禁用过渡，否则拖动手感被动画拖慢 */
.ai-panel.is-resizing {
  transition: none;
}

/* 左边缘拖宽手柄 */
.ai-grip {
  position: absolute;
  top: 14px;
  bottom: 14px;
  left: -4px;
  width: 8px;
  cursor: col-resize;
  border-radius: 4px;
  background: transparent;
  transition: background 0.15s;
}

.ai-grip:hover {
  background: var(--el-color-primary-light-7);
}

/* 头部 */
.ai-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 14px 10px;
}

.ai-head-main {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.ai-head-icon {
  display: inline-flex;
  color: var(--el-color-primary);
}

.ai-title {
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.ai-chip {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--el-fill-color-light);
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.ai-head-actions {
  display: flex;
  gap: 2px;
}

.ai-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.ai-icon-btn:hover:not(:disabled) {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
}

.ai-icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* 上下文条：圆角小条 */
.ai-context {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 0 14px 8px;
  padding: 6px 10px;
  border-radius: 10px;
  background: var(--el-fill-color-light);
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.ai-ctx-tag {
  color: var(--el-text-color-primary);
  font-weight: 500;
}

.ai-ctx-ok {
  color: var(--el-color-success);
}

.ai-ctx-dim {
  color: var(--el-text-color-placeholder);
}

.ai-blocked {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0 14px 8px;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--el-color-warning-light-9);
  font-size: 12px;
  color: var(--el-color-warning-dark-2);
}

.ai-blocked.is-error {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger-dark-2);
}

/* 消息区 */
.ai-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 14px 8px;
}

.ai-empty-title {
  margin: 6px 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

/* 动作卡（空态）：竖排两列自适应，卡片圆润带投影 */
.ai-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.ai-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  text-align: left;
  border: 1px solid var(--mizuki-soft-card-border);
  border-radius: 14px;
  background: var(--el-bg-color);
  cursor: pointer;
  transition: border-color 0.16s, box-shadow 0.16s, transform 0.16s;
}

.ai-card:hover:not(:disabled) {
  border-color: var(--el-color-primary-light-5);
  box-shadow: var(--el-box-shadow-light);
  transform: translateY(-1px);
}

.ai-card:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ai-card-label {
  font-size: 13px;
  color: var(--el-text-color-primary);
}

.ai-card-hint {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
}

.ai-empty-hint {
  margin: 12px 0 4px;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  text-align: center;
}

/* 顶部动作行（有消息时） */
.ai-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

/* 胶囊按钮（动作 / 三键共用） */
.ai-pill {
  padding: 4px 12px;
  border: 1px solid var(--mizuki-soft-card-border);
  border-radius: 999px;
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.ai-pill:hover:not(:disabled) {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.ai-pill:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* 消息气泡 */
.ai-msg {
  margin-bottom: 10px;
  padding: 9px 12px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}

.ai-msg.is-user {
  background: var(--el-color-primary-light-9);
  color: var(--el-text-color-primary);
}

.ai-msg.is-assistant {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
}

.ai-msg.is-error {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger-dark-2);
}

.ai-msg-tag {
  margin-bottom: 4px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.ai-msg-body {
  white-space: pre-wrap;
}

.ai-msg-inserted {
  display: inline-block;
  margin-top: 4px;
  font-size: 11px;
  color: var(--el-color-success);
}

/* 三键 */
.ai-insert {
  display: flex;
  gap: 6px;
  padding: 8px 14px 0;
  border-top: none;
  /* [UI-U3] 分隔改成两端淡出的发丝线 */
  background-image: var(--mizuki-fade-hairline);
  background-repeat: no-repeat;
  background-position: left top;
  background-size: 100% 1px;
}

/* 输入区 */
.ai-input {
  padding: 8px 14px 14px;
}

.ai-input-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
}

.ai-disclaimer {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
}

.ai-input-btns {
  display: flex;
  gap: 6px;
}

/* 发送按钮：圆形主色（参照火山的圆形发送） */
.ai-send {
  min-width: 56px;
  padding: 5px 14px;
  border: none;
  border-radius: 999px;
  background: var(--el-color-primary);
  color: var(--el-color-white);
  font-size: 12px;
  cursor: pointer;
  transition: opacity 0.15s, background 0.15s;
}

.ai-send:hover:not(:disabled) {
  opacity: 0.9;
}

.ai-send:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ai-send.is-stop {
  background: var(--el-color-danger);
}
</style>
