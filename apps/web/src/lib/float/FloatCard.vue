<script setup lang="ts">
/**
 * [UI-U2 / T1] 浮动卡片视觉外壳组件（支持头部拖拽与 8 方向缩放）
 * [状态] ACTIVE
 */
import { computed } from 'vue';
import type { FloatRect, ResizeDirection } from './use-float-card';

const props = withDefaults(
  defineProps<{
    title?: string;
    rect: FloatRect;
    isDragging?: boolean;
    isResizing?: boolean;
    enabled?: boolean;
  }>(),
  {
    title: '',
    isDragging: false,
    isResizing: false,
    enabled: true,
  },
);

const emit = defineEmits<{
  (e: 'headerPointerDown', event: PointerEvent): void;
  (e: 'handlePointerDown', dir: ResizeDirection, event: PointerEvent): void;
  (e: 'cardClick'): void;
}>();

const RESIZE_HANDLES: ResizeDirection[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

const styleObject = computed(() => {
  if (!props.enabled) {
    return {};
  }
  return {
    transform: `translate3d(${props.rect.x}px, ${props.rect.y}px, 0)`,
    width: `${props.rect.w}px`,
    height: `${props.rect.h}px`,
    zIndex: props.rect.z,
  };
});
</script>

<template>
  <div
    class="float-card panel-card"
    :class="{
      'is-floating': enabled,
      'is-dragging': isDragging,
      'is-resizing': isResizing,
    }"
    :style="styleObject"
    @pointerdown="emit('cardClick')"
  >
    <!-- 卡片头部（拖拽把手） -->
    <div
      class="float-card__header"
      :class="{ 'is-draggable': enabled }"
      @pointerdown="emit('headerPointerDown', $event)"
    >
      <slot name="header">
        <div class="header-default">
          <span class="header-drag-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
              <circle cx="8" cy="6" r="1.5" />
              <circle cx="16" cy="6" r="1.5" />
              <circle cx="8" cy="12" r="1.5" />
              <circle cx="16" cy="12" r="1.5" />
              <circle cx="8" cy="18" r="1.5" />
              <circle cx="16" cy="18" r="1.5" />
            </svg>
          </span>
          <span class="header-title">{{ title }}</span>
        </div>
      </slot>
      <div class="header-extra">
        <slot name="extra" />
      </div>
    </div>

    <!-- 卡片主体内容 -->
    <div class="float-card__body">
      <slot />
    </div>

    <!-- 8 方向缩放把手（仅在浮动模式下渲染） -->
    <template v-if="enabled">
      <div
        v-for="dir in RESIZE_HANDLES"
        :key="dir"
        :class="['float-handle', `float-handle--${dir}`]"
        @pointerdown.stop="emit('handlePointerDown', dir, $event)"
      />
    </template>
  </div>
</template>

<style scoped>
.float-card {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
  background: var(--el-bg-color);
  border: 1px solid var(--mizuki-border-hairline);
  border-radius: var(--mizuki-radius-card);
  box-shadow: var(--mizuki-card-shadow);
  transition: box-shadow var(--mizuki-motion-base), border-color var(--mizuki-motion-base);
}

.float-card.is-floating {
  position: absolute;
  top: 0;
  left: 0;
  margin: 0;
}

.float-card.is-dragging,
.float-card.is-resizing {
  transition: none !important;
  user-select: none !important;
  box-shadow: var(--mizuki-lift-shadow) !important;
  border-color: var(--el-color-primary-light-5) !important;
}

.float-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--el-fill-color-extra-light);
  border-bottom: 1px solid var(--mizuki-border-hairline);
  user-select: none;
  flex-shrink: 0;
}

.float-card__header.is-draggable {
  cursor: grab;
  touch-action: none;
}

.float-card.is-dragging .float-card__header {
  cursor: grabbing;
}

.header-default {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.header-drag-icon {
  display: inline-flex;
  align-items: center;
  color: var(--el-text-color-placeholder);
  opacity: 0.7;
}

.header-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-extra {
  display: flex;
  align-items: center;
  gap: 8px;
}

.float-card__body {
  flex: 1;
  overflow: auto;
  padding: 16px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}

/* ── 8 方向缩放把手样式 ── */
.float-handle {
  position: absolute;
  box-sizing: border-box;
  z-index: 10;
  touch-action: none;
}

/* 四边 */
.float-handle--n {
  top: 0;
  left: 10px;
  right: 10px;
  height: 6px;
  cursor: ns-resize;
}

.float-handle--s {
  bottom: 0;
  left: 10px;
  right: 10px;
  height: 6px;
  cursor: ns-resize;
}

.float-handle--w {
  top: 10px;
  bottom: 10px;
  left: 0;
  width: 6px;
  cursor: ew-resize;
}

.float-handle--e {
  top: 10px;
  bottom: 10px;
  right: 0;
  width: 6px;
  cursor: ew-resize;
}

/* 四角 */
.float-handle--nw {
  top: 0;
  left: 0;
  width: 12px;
  height: 12px;
  cursor: nwse-resize;
}

.float-handle--ne {
  top: 0;
  right: 0;
  width: 12px;
  height: 12px;
  cursor: nesw-resize;
}

.float-handle--sw {
  bottom: 0;
  left: 0;
  width: 12px;
  height: 12px;
  cursor: nesw-resize;
}

.float-handle--se {
  bottom: 0;
  right: 0;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
}

/* 右下角视觉指示小标志 */
.float-handle--se::after {
  content: '';
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 6px;
  height: 6px;
  border-right: 2px solid var(--el-text-color-placeholder);
  border-bottom: 2px solid var(--el-text-color-placeholder);
  border-radius: 1px;
  opacity: 0.6;
  transition: border-color var(--mizuki-motion-fast), opacity var(--mizuki-motion-fast);
}

.float-card:hover .float-handle--se::after {
  border-color: var(--el-color-primary);
  opacity: 1;
}

/* 窄屏幕媒体查询降级兜底 */
@media (max-width: 1279px) {
  .float-card.is-floating {
    position: static !important;
    transform: none !important;
    width: 100% !important;
    height: auto !important;
    margin-bottom: 16px;
  }
  .float-handle {
    display: none !important;
  }
  .float-card__header.is-draggable {
    cursor: default !important;
  }
}
</style>
