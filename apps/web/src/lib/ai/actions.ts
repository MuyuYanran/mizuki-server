/**
 * [U4-AI2] 动作短指令（**只放一行短句，不放提示词模板**）
 *
 * 分工（指令包 §4.3）：
 * - 本文件：一行中文短指令，作为 `messages[0]` 的用户意图；
 * - 服务端 `apps/server/src/modules/ai/prompts.ts`：真正的风格/格式约束 + `action` 对应的
 *   系统提示 + `<document>` 包裹的稿件注入。
 *
 * 为什么不在前端写长模板：换文风要改一处（服务端），否则同一份语义在浏览器与服务端各漂一份。
 * 前端**绝不要**自己拼 `<document>`。
 */
import type { AiAction } from '@mizuki/shared';

export const AI_ACTION_HINTS: Record<AiAction, string> = {
  polish: '请润色下面的文字。',
  continue: '请接着下面的内容继续写。',
  summarize: '请概括下面的内容。',
  meta: '请为下面的内容生成标题、摘要与标签。',
  translate: '请翻译下面的内容。',
};

/** 自由对话（无动作）时的占位提示 */
export const AI_CHAT_PLACEHOLDER = '问点什么，或选中文字后用上方动作…';
