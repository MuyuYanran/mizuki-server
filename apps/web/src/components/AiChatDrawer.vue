<script setup lang="ts">
/**
 * [U4-AI2] 全局右侧 AI 聊天栏
 *
 * 形态（PM 裁定）：整体窗口右侧、可收起、可拖宽；任何页面都能纯聊天，
 * 编辑页挂上上下文后才解锁 5 个动作与三键插入。
 *
 * 四条硬纪律：
 * ① **AI 输出只用文本插值渲染**（`{{ }}`），禁 `v-html` —— 模型输出是不可信文本；
 * ② **永不自动写编辑器**：输出只进消息气泡，写入必须人工点三键之一；
 * ③ **会话不落 localStorage**（含正文），刷新即空是特性；
 * ④ 上下文**惰性**取（点动作/发送时才 `getText()`），不在打字路径上同步全文。
 *
 * 宽窄两态：>=1280px 用 `el-aside` 挤压正文（可拖宽，宽度持久化）；
 * 更窄时改为覆盖式浮层 + 遮罩（不挤压正文，避免小屏正文碎成一条缝）。
 */
import { computed, nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { AI_ACTION_LABELS, AI_ACTIONS, AI_LIMITS, truncateForContext, type AiAction } from '@mizuki/shared';
import { useSplitter } from '../lib/float/use-splitter';
import { aiApi, aiFailureText } from '../api/ai';
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

// ── 布局 ────────────────────────────────────────────────────────────
const {
  width: drawerWidth,
  isDragging,
  isWide,
  onPointerDown,
} = useSplitter({
  storageKey: 'mizuki.layout.ai-drawer.v1',
  defaultWidth: 380,
  min: 320,
  max: 640,
});

/** 窄屏时覆盖式浮层的宽度上限（不挤压正文） */
const overlayWidth = computed(() => Math.min(drawerWidth.value, 520));
const asideWidth = computed(() => (isWide.value ? drawerWidth.value : overlayWidth.value));

// ── 状态派生 ────────────────────────────────────────────────────────
const ready = computed(() => isAiReady(aiConfig.value));
const currentProfile = computed(() => activeProfile(aiConfig.value));
const contextInfo = computed(() => describeActiveContext());
const hasContext = computed(() => contextInfo.value !== null);
const hasSelection = computed(() => contextInfo.value?.hasSelection === true);

/** 发送禁用原因（null = 可发送）；文案直接展示给用户，避免"按钮灰了不知道为什么" */
const blockedReason = computed<string | null>(() => {
  if (aiConfig.value === null) return aiConfigError.value ?? '正在加载 AI 配置…';
  if (!aiConfig.value.enabled) return 'AI 功能未启用';
  if (aiConfig.value.activeProfileId === null) return '未选择服务档案';
  if (!ready.value) return '当前档案不可用';
  return null;
});

const canSend = computed(() => blockedReason.value === null && !aiStreaming.value);
const lastAssistant = computed<AiMessage | null>(() => {
  for (let i = aiMessages.value.length - 1; i >= 0; i -= 1) {
    const message = aiMessages.value[i];
    if (message !== undefined && message.role === 'assistant' && message.error === undefined) {
      return message;
    }
  }
  return null;
});
/** 三键只在「有可插入的助手输出」且当前有编辑器上下文时可用 */
const canInsert = computed(() => lastAssistant.value !== null && hasContext.value);

const input = ref('');
const listRef = ref<HTMLElement | null>(null);
let abortStream: (() => void) | null = null;

// ── 滚动：新增/流式增量都跟到底部 ────────────────────────────────
async function scrollToBottom(): Promise<void> {
  await nextTick();
  const el = listRef.value;
  if (el !== null) {
    el.scrollTop = el.scrollHeight;
  }
}
watch(
  () => aiMessages.value.length,
  () => {
    void scrollToBottom();
  },
);

// ── 打开抽屉时拉配置（幂等；失败降级为引导条） ────────────────
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

// ── 流式执行 ────────────────────────────────────────────────────────
/** 组装一次请求的上下文（惰性取文本 + 裁剪 + 明示截断） */
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

/** 发起一次流式请求并管理 UI 三态（流式中 / 中止 / 错误） */
function runStream(body: {
  action?: AiAction;
  userText: string;
  /** 是否把 userText 追加成一条用户消息（动作按钮不需要） */
  echoUser: boolean;
}): void {
  if (aiStreaming.value) return;

  const context = buildContext();
  const assistant = pushMessage({
    role: 'assistant',
    content: '',
    ...(body.action !== undefined ? { action: body.action } : {}),
  });
  if (body.echoUser) {
    // 用户消息插在助手消息之前（pushMessage 已把助手放在末尾，这里做一次交换）
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
      ...(context !== undefined
        ? { context: { kind: context.kind, text: context.text } }
        : {}),
    },
    {
      onDelta: (text) => {
        appendToMessage(assistant, text);
        void scrollToBottom();
      },
      onDone: () => {
        aiStreaming.value = false;
        abortStream = null;
        if (assistant.content.trim() === '') {
          assistant.error = '模型没有返回内容。';
        }
        void scrollToBottom();
      },
      onError: (error, aborted) => {
        aiStreaming.value = false;
        abortStream = null;
        if (aborted) {
          // 主动中止不是错误：保留已收到的文本，不弹红条
          if (assistant.content.trim() === '') {
            assistant.error = '已中止（未收到内容）。';
          }
          return;
        }
        assistant.error = error.message;
        void scrollToBottom();
      },
    },
  );

  // 上下文被截断时，明确告知（不许静默截断）
  if (context !== undefined && context.truncated) {
    ElMessage.warning(
      `上下文已截断：送出 ${AI_LIMITS.maxContextChars} 字 / 原文 ${context.originalChars} 字`,
    );
  }
}

/** 点动作按钮：用短指令 + 上下文发起 */
function runAction(action: AiAction): void {
  if (!canSend.value) return;
  runStream({ action, userText: AI_ACTION_HINTS[action], echoUser: false });
}

/** 发送自由输入 */
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
  // Enter 发送、Shift+Enter 换行；输入法组合期不响应（中文拼音回车选词）
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

function close(): void {
  stop();
  setDrawerOpen(false);
}

defineExpose({ toggleDrawer });
</script>

<template>
  <!-- 遮罩：仅窄屏浮层态出现 -->
  <div
    v-if="aiDrawerOpen && !isWide"
    class="ai-drawer-mask"
    @click="close"
  />
  <el-aside
    v-if="aiDrawerOpen"
    :width="`${asideWidth}px`"
    :class="['ai-drawer', { 'is-overlay': !isWide }]"
  >
    <!-- 拖宽手柄（窄屏浮层态不显示） -->
    <div
      v-if="isWide"
      :class="['ai-drawer-grip', { 'is-dragging': isDragging }]"
      title="拖动调整宽度"
      @pointerdown="onPointerDown"
    />

    <header class="ai-head">
      <div class="ai-head-main">
        <span class="ai-title">AI 助手</span>
        <span v-if="currentProfile" class="ai-profile">
          {{ currentProfile.name }} · {{ currentProfile.model }}
        </span>
      </div>
      <div class="ai-head-actions">
        <el-button
          text
          size="small"
          :disabled="aiMessages.length === 0 || aiStreaming"
          @click="clearMessages()"
        >
          清空
        </el-button>
        <el-button text size="small" @click="close">收起</el-button>
      </div>
    </header>

    <!-- 上下文条：无上下文时明确说"未挂载"，动作按钮全禁用 -->
    <div class="ai-context">
      <template v-if="contextInfo">
        <span class="ai-context-kind">
          {{ contextInfo.kind === 'selection' ? '选区' : '当前文档' }}
        </span>
        <span class="ai-context-chars">{{ contextInfo.chars }} 字</span>
        <span v-if="contextInfo.hasSelection" class="ai-context-sel">有选区</span>
        <span v-else class="ai-context-nosel">无选区（替换不可用）</span>
      </template>
      <span v-else class="ai-context-empty">未挂载上下文（纯对话模式）</span>
    </div>

    <!-- 未就绪：引导而非报错 -->
    <div v-if="blockedReason" class="ai-blocked">
      <span>{{ blockedReason }}</span>
      <el-button size="small" type="primary" plain @click="gotoConfig">去配置</el-button>
    </div>

    <!-- 动作行 -->
    <div class="ai-actions">
      <el-button
        v-for="action in AI_ACTIONS"
        :key="action"
        size="small"
        :disabled="!canSend || !hasContext"
        @click="runAction(action)"
      >
        {{ AI_ACTION_LABELS[action] }}
      </el-button>
    </div>

    <!-- 消息列表 -->
    <div ref="listRef" class="ai-messages">
      <p v-if="aiMessages.length === 0" class="ai-empty">
        选中编辑器里的文字再用上方动作，或直接问点什么。
      </p>
      <div
        v-for="message in aiMessages"
        :key="message.id"
        :class="['ai-msg', `is-${message.role}`, { 'is-error': message.error !== undefined }]"
      >
        <div v-if="message.action" class="ai-msg-action">{{ AI_ACTION_LABELS[message.action] }}</div>
        <!-- AI 输出只用文本插值（禁 v-html：模型输出是不可信文本） -->
        <div class="ai-msg-body">{{ message.error ?? message.content }}</div>
        <span v-if="message.inserted" class="ai-msg-inserted">已插入</span>
      </div>
    </div>

    <!-- 三键：只在有输出且有上下文时可用 -->
    <div class="ai-insert">
      <el-button size="small" :disabled="!canInsert || !hasSelection" @click="replaceSelection">
        替换选区
      </el-button>
      <el-button size="small" :disabled="!canInsert" @click="insertToCursor">插入到光标</el-button>
      <el-button size="small" :disabled="lastAssistant === null" @click="copyOutput">复制</el-button>
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
      <div class="ai-input-actions">
        <el-button v-if="aiStreaming" size="small" type="danger" plain @click="stop">中止</el-button>
        <el-button v-else size="small" type="primary" :disabled="!canSend || input.trim() === ''" @click="send">
          发送
        </el-button>
      </div>
    </div>
  </el-aside>
</template>

<style scoped>
/* 颜色全挂 Element 变量（随亮/暗主题切换，本文件零硬编码颜色） */
.ai-drawer {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--el-bg-color);
  border-left: 1px solid var(--el-border-color);
}

/* 窄屏：覆盖式浮层（fixed，不挤压正文） */
.ai-drawer.is-overlay {
  position: fixed;
  top: 60px;
  right: 0;
  bottom: 0;
  z-index: 2000;
  box-shadow: var(--el-box-shadow-dark);
}

.ai-drawer-mask {
  position: fixed;
  inset: 60px 0 0 0;
  z-index: 1999;
  background: var(--el-overlay-color-lighter);
}

.ai-drawer-grip {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -3px;
  width: 6px;
  cursor: col-resize;
  background: transparent;
  transition: background 0.15s;
}

.ai-drawer-grip:hover,
.ai-drawer-grip.is-dragging {
  background: var(--el-color-primary-light-7);
}

.ai-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--el-border-color);
}

.ai-head-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.ai-title {
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.ai-profile {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-head-actions {
  display: flex;
  flex-shrink: 0;
}

.ai-context {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 12px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
}

.ai-context-kind {
  color: var(--el-text-color-primary);
}

.ai-context-sel {
  color: var(--el-color-success);
}

.ai-context-nosel,
.ai-context-empty {
  color: var(--el-text-color-placeholder);
}

.ai-blocked {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 8px 12px 0;
  padding: 8px 10px;
  font-size: 12px;
  border-radius: 6px;
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning-dark-2);
}

.ai-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 12px;
}

.ai-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 12px 8px;
}

.ai-empty {
  margin: 24px 0;
  text-align: center;
  font-size: 13px;
  color: var(--el-text-color-placeholder);
}

.ai-msg {
  margin-bottom: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.6;
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

.ai-msg-action {
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

.ai-insert {
  display: flex;
  gap: 6px;
  padding: 8px 12px 0;
  border-top: 1px solid var(--el-border-color);
}

.ai-input {
  padding: 8px 12px 12px;
}

.ai-input-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 6px;
}
</style>
