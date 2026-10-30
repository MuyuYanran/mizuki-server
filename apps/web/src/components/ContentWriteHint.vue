<script setup lang="ts">
/**
 * [T6a] 内容落点提示条（写操作可用性 / 只读态 / 需同步提示的**统一呈现**）
 *
 * [职责] 把「这批内容当前能不能写、写完要不要同步」这件事，用一条**明确、可执行**的提示
 *   呈现在页面顶部，而不是等用户点保存才弹 403。
 *
 * [为什么要有它 —— 这是 T6a 最实际的价值]
 *   后端已经做到「零静默丢数据」：不可写时给 403 + 指路牌。但对用户来说，
 *   「填完表单、点保存、被拒」仍是一次挫败。把理由**提前**摆在页面上，
 *   用户就不会白填一遍。
 *
 * [它只呈现，不判定]
 *   所有判定来自后端：`needsSync` 是写响应的字段，只读态来自 API 的 403/`readOnly`。
 *   本组件不做任何「按主题名猜能力」的逻辑 —— 那必然会与后端劈叉。
 *
 * [三态]
 *   - `info`：内容落在内容仓，改完需要跑一次同步才生效（正常流程提示，不吓人）；
 *   - `warning`：**只读**（如 git 源下读的是工作副本，写会被拒）——明确告知不可写及原因；
 *   - `error`：写入被拒（403/404）——展示服务端原话（其文案已含「下一步」且零绝对路径）。
 */
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    /** 三态 */
    tone?: 'info' | 'warning' | 'error';
    /** 主文案（服务端 message 或页面自撰的短说明） */
    message: string;
    /** 可选的附加说明（如「真源在内容仓」这类背景） */
    detail?: string;
    /** 是否可关闭（默认不可关：这是操作前提，不该被随手关掉后遗忘） */
    closable?: boolean;
  }>(),
  { tone: 'info', detail: '', closable: false },
);

/** el-alert 的 type 映射（warning/error 同名；info 同名，此处保留映射以便将来细分） */
const alertType = computed<'info' | 'warning' | 'error'>(() => props.tone);
</script>

<template>
  <el-alert
    class="content-hint"
    :type="alertType"
    :closable="closable"
    show-icon
    :title="message"
  >
    <template v-if="detail !== ''" #default>
      <span class="content-hint__detail">{{ detail }}</span>
    </template>
  </el-alert>
</template>

<style scoped>
.content-hint {
  margin-bottom: 12px;
  border-radius: var(--mizuki-radius-md, 10px);
}

.content-hint__detail {
  font-size: 12px;
  line-height: 1.6;
  opacity: 0.85;
}
</style>
