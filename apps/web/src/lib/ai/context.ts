/**
 * [U4-AI2] 编辑器 ⇄ 聊天栏 的上下文注册（本包的关键接线）
 *
 * 为什么用"注册"而不是 props 逐层传：聊天栏挂在 `MainLayout`，编辑页在 `router-view`
 * 深处，两者不是父子；而且**任意页面**都要能纯聊天（无上下文）。
 *
 * 契约（指令包 §4.2）：
 * - 编辑页 `onMounted` 注册、`onBeforeUnmount` 注销（返回的就是注销函数）；
 * - 文本获取**惰性**：`getText()` 只在点动作/发送时调用，避免每次按键同步全文；
 * - 同一时刻只有一个活动上下文（后注册覆盖先前；注销时只有"自己仍是当前"才清空，
 *   防止 A 卸载时把 B 的注册抹掉）。
 *
 * 纪律：本模块不 import 任何编辑器组件（否则会把 TipTap/Vditor/CodeMirror 全打进主包）。
 */
import { ref } from 'vue';
import type { AiContextKind } from '@mizuki/shared';

export interface AiContextRegistration {
  /** 上下文种类：article（富文本）/ markdown（md 源码）/ selection（选区） */
  kind: Exclude<AiContextKind, 'none'>;
  /** 惰性取全文（编辑器实现方决定是 getValue 还是 getJSON 拍平） */
  getText: () => string;
  /** 当前是否有选区（决定「替换选区」是否可用） */
  hasSelection: () => boolean;
  /** 在光标处插入纯文本 */
  insertText: (text: string) => void;
  /** 替换当前选区（无选区时实现方应退化为插入） */
  replaceText: (text: string) => void;
}

/** 当前活动上下文（模板里读它来渲染上下文条与按钮可用态） */
export const activeAiContext = ref<AiContextRegistration | null>(null);

/**
 * 注册上下文，返回**注销函数**。
 *
 * 注销语义：只有当 `activeAiContext.value` 仍是本次注册的对象时才清空
 * （快速切换编辑页时，旧页面的 unmount 可能晚于新页面的 mount）。
 */
export function registerAiContext(reg: AiContextRegistration): () => void {
  activeAiContext.value = reg;
  return () => {
    if (activeAiContext.value === reg) {
      activeAiContext.value = null;
    }
  };
}

/**
 * 编辑器实例的最小接口（三件套各有实现，`ref` 拿到的就是它）。
 *
 * `getValue` 声明为**必需**：PostEditPage / AboutEditPage 的既有代码会直接
 * `editorRef.value.getValue()`（引擎切换时读当前值），收窄成可选会让那两处编译失败。
 * 其余是 U4-AI2 新增的**可选**能力——编辑器没实现就走退化路径。
 */
export interface AiEditorHandle {
  getValue: () => string;
  getPlainText?: () => string;
  getSelectedText?: () => string;
  hasSelection?: () => boolean;
  insertAtCursor?: (text: string) => void;
  insertPlainText?: (text: string) => void;
  replaceSelection?: (text: string) => void;
}

/**
 * [U4-AI2] 编辑页的**一行式**上下文注册（三个编辑页共用，避免三份重复接线）。
 *
 * - `getText`：优先 `getPlainText`（TipTap）→ 否则 `getValue`（Vditor/CodeMirror）；
 * - `hasSelection`：编辑器没暴露查询能力时**保守返回 false**（「替换选区」置灰，
 *   而不是让用户以为能替换却什么都没发生）；
 * - `insertText`：TipTap 用 `insertPlainText`（按空行切段建 paragraph），
 *   另两个用既有的 `insertAtCursor`；
 * - `replaceText`：优先编辑器的 `replaceSelection`；没有就退化为插入
 *   （Vditor 的退化语义见其实现注释）。
 *
 * 返回注销函数；`editorRef` 是 Vue 的模板 ref（可能为 null，调用时才解引用）。
 */
export function registerEditorContext(
  kind: 'article' | 'markdown',
  editorRef: { value: AiEditorHandle | null },
): () => void {
  const read = (): string => {
    const editor = editorRef.value;
    if (editor === null) return '';
    if (typeof editor.getPlainText === 'function') return editor.getPlainText();
    return editor.getValue();
  };

  return registerAiContext({
    kind,
    getText: read,
    hasSelection: () => {
      const editor = editorRef.value;
      if (editor === null || typeof editor.hasSelection !== 'function') return false;
      return editor.hasSelection();
    },
    insertText: (text: string): void => {
      const editor = editorRef.value;
      if (editor === null) return;
      if (typeof editor.insertPlainText === 'function') {
        editor.insertPlainText(text);
        return;
      }
      editor.insertAtCursor?.(text);
    },
    replaceText: (text: string): void => {
      const editor = editorRef.value;
      if (editor === null) return;
      if (typeof editor.replaceSelection === 'function') {
        editor.replaceSelection(text);
        return;
      }
      editor.insertAtCursor?.(text);
    },
  });
}

/** 读取当前注册（无则 null） */
export function getActiveAiContext(): AiContextRegistration | null {
  return activeAiContext.value;
}

/**
 * 供聊天栏展示：当前上下文的字数与是否有选区。
 * 这会在**渲染时**调用 `getText()` —— 只在上下文条上用，不要在输入处理器里用。
 */
export function describeActiveContext(): { kind: AiContextKind; chars: number; hasSelection: boolean } | null {
  const reg = activeAiContext.value;
  if (reg === null) return null;
  const text = reg.getText();
  return { kind: reg.kind, chars: text.length, hasSelection: reg.hasSelection() };
}
