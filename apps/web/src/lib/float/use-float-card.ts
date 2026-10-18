/**
 * [UI-U2 / T1] 浮动卡片拖拽与 8 方向缩放核心 Composable
 * [状态] ACTIVE
 */
import { onBeforeUnmount, ref, watch } from 'vue';
import { bringToFront } from './z-manager';

export interface FloatRect {
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

export interface UseFloatCardOptions {
  /** 持久化键内卡片 id（如 'stat-posts'） */
  id: string;
  /** localStorage 存储键（如 'mizuki.layout.dashboard.v1'） */
  storageKey: string;
  /** 首次默认布局 */
  defaults: FloatRect;
  /** 最小尺寸限制（缺省 260×160，K1） */
  min?: { w: number; h: number };
  /** 画布实时尺寸获取器（拖/缩时活取） */
  bounds: () => { w: number; h: number };
  /** 是否启用浮动能力（K5：窄视口为 false） */
  enabled: () => boolean;
}

export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface StoragePayload {
  version: 1;
  cards: Record<string, FloatRect>;
}

function readStorage(key: string): Record<string, FloatRect> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoragePayload;
    if (parsed && parsed.version === 1 && typeof parsed.cards === 'object' && parsed.cards !== null) {
      return parsed.cards;
    }
    return null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, cardId: string, rect: FloatRect): void {
  try {
    const existing = readStorage(key) ?? {};
    existing[cardId] = { ...rect };
    const payload: StoragePayload = {
      version: 1,
      cards: existing,
    };
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // 存储受阻静默失败（K4）
  }
}

export function useFloatCard(options: UseFloatCardOptions) {
  const minW = options.min?.w ?? 260;
  const minH = options.min?.h ?? 160;

  // 1. 初始化持久化位置
  function initRect(): FloatRect {
    const stored = readStorage(options.storageKey);
    const card = stored ? stored[options.id] : undefined;
    if (
      card &&
      Number.isFinite(card.x) &&
      Number.isFinite(card.y) &&
      Number.isFinite(card.w) &&
      Number.isFinite(card.h) &&
      card.w >= minW &&
      card.h >= minH
    ) {
      return { ...card, z: card.z ?? 100 };
    }
    return { ...options.defaults };
  }

  const rect = ref<FloatRect>(initRect());
  const isDragging = ref(false);
  const isResizing = ref(false);

  // 动作开始前的快照（供 ESC 回弹，K6）
  let snapshotRect: FloatRect | null = null;
  let startPointer = { x: 0, y: 0 };
  let activeDir: ResizeDirection | null = null;
  let activePointerId: number | null = null;
  let activeElement: HTMLElement | null = null;

  // 钳制位置与尺寸（K1：全量钳制在画布内）
  function clampRect(r: FloatRect): FloatRect {
    const b = options.bounds();
    const w = Math.max(minW, Math.min(r.w, Math.max(minW, b.w)));
    const h = Math.max(minH, Math.min(r.h, Math.max(minH, b.h)));
    const maxX = Math.max(0, b.w - w);
    const maxY = Math.max(0, b.h - h);
    const x = Math.max(0, Math.min(r.x, maxX));
    const y = Math.max(0, Math.min(r.y, maxY));
    return { x, y, w, h, z: r.z };
  }

  function bringCardToFront(): void {
    rect.value.z = bringToFront();
  }

  // ── 拖拽处理 ──
  function onHeaderPointerDown(e: PointerEvent): void {
    if (!options.enabled() || e.button !== 0) return;
    // 排除头部中的按钮等交互控件
    const target = e.target as HTMLElement | null;
    if (target && target.closest('button, a, input, select, textarea, .no-drag')) {
      return;
    }

    e.preventDefault();
    bringCardToFront();

    isDragging.value = true;
    snapshotRect = { ...rect.value };
    startPointer = { x: e.clientX, y: e.clientY };
    activePointerId = e.pointerId;
    activeElement = e.currentTarget as HTMLElement | null;

    try {
      activeElement?.setPointerCapture(e.pointerId);
    } catch {
      // 容错
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('keydown', onKeyDown);
  }

  // ── 缩放处理 ──
  function onHandlePointerDown(dir: ResizeDirection, e: PointerEvent): void {
    if (!options.enabled() || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    bringCardToFront();

    isResizing.value = true;
    activeDir = dir;
    snapshotRect = { ...rect.value };
    startPointer = { x: e.clientX, y: e.clientY };
    activePointerId = e.pointerId;
    activeElement = e.currentTarget as HTMLElement | null;

    try {
      activeElement?.setPointerCapture(e.pointerId);
    } catch {
      // 容错
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('keydown', onKeyDown);
  }

  // ── 指针移动 ──
  function onPointerMove(e: PointerEvent): void {
    if (!snapshotRect) return;
    const dx = e.clientX - startPointer.x;
    const dy = e.clientY - startPointer.y;

    if (isDragging.value) {
      rect.value = clampRect({
        ...snapshotRect,
        x: snapshotRect.x + dx,
        y: snapshotRect.y + dy,
      });
    } else if (isResizing.value && activeDir) {
      let newX = snapshotRect.x;
      let newY = snapshotRect.y;
      let newW = snapshotRect.w;
      let newH = snapshotRect.h;

      // 8 方向调整
      if (activeDir.includes('e')) {
        newW = Math.max(minW, snapshotRect.w + dx);
      }
      if (activeDir.includes('s')) {
        newH = Math.max(minH, snapshotRect.h + dy);
      }
      if (activeDir.includes('w')) {
        const potentialW = snapshotRect.w - dx;
        if (potentialW >= minW) {
          newW = potentialW;
          newX = snapshotRect.x + dx;
        } else {
          newW = minW;
          newX = snapshotRect.x + (snapshotRect.w - minW);
        }
      }
      if (activeDir.includes('n')) {
        const potentialH = snapshotRect.h - dy;
        if (potentialH >= minH) {
          newH = potentialH;
          newY = snapshotRect.y + dy;
        } else {
          newH = minH;
          newY = snapshotRect.y + (snapshotRect.h - minH);
        }
      }

      rect.value = clampRect({
        x: newX,
        y: newY,
        w: newW,
        h: newH,
        z: snapshotRect.z,
      });
    }
  }

  // ── 释放与持久化 ──
  function finishInteraction(save: boolean): void {
    if (activePointerId !== null && activeElement) {
      try {
        if (activeElement.hasPointerCapture(activePointerId)) {
          activeElement.releasePointerCapture(activePointerId);
        }
      } catch {
        // 容错
      }
    }

    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    window.removeEventListener('keydown', onKeyDown);

    if (save && (isDragging.value || isResizing.value)) {
      writeStorage(options.storageKey, options.id, rect.value);
    }

    isDragging.value = false;
    isResizing.value = false;
    activeDir = null;
    snapshotRect = null;
    activePointerId = null;
    activeElement = null;
  }

  function onPointerUp(): void {
    finishInteraction(true);
  }

  function onPointerCancel(): void {
    if (snapshotRect) {
      rect.value = { ...snapshotRect };
    }
    finishInteraction(false);
  }

  // ── ESC 取消并回弹（K6） ──
  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && (isDragging.value || isResizing.value)) {
      e.preventDefault();
      if (snapshotRect) {
        rect.value = { ...snapshotRect };
      }
      finishInteraction(false);
    }
  }

  // 重置布局（调用方外部触发）
  function reset(newDefaults?: FloatRect): void {
    const d = newDefaults ?? options.defaults;
    rect.value = { ...d };
    try {
      const stored = readStorage(options.storageKey);
      if (stored && options.id in stored) {
        delete stored[options.id];
        if (Object.keys(stored).length > 0) {
          localStorage.setItem(options.storageKey, JSON.stringify({ version: 1, cards: stored }));
        } else {
          localStorage.removeItem(options.storageKey);
        }
      }
    } catch {
      // 容错
    }
  }

  // ── [UI-U2fix] 画布尺寸变化支持 ──

  /** 仅当该卡片无持久化布局时套用新默认值（K4：不覆盖用户自定义） */
  function applyDefaultsIfPristine(d: FloatRect): void {
    const stored = readStorage(options.storageKey);
    if (!stored || !(options.id in stored)) {
      rect.value = clampRect({ ...d });
    }
  }

  /** 把当前矩形重新钳制回画布内（窗口/侧栏变化后兜底，不写持久化） */
  function reclamp(): void {
    rect.value = clampRect({ ...rect.value });
  }

  // 侦听外部 defaults 更新（如画布尺寸变更）
  watch(
    () => options.defaults,
    (d) => {
      applyDefaultsIfPristine(d);
    },
    { deep: true },
  );

  onBeforeUnmount(() => {
    finishInteraction(false);
  });

  return {
    rect,
    isDragging,
    isResizing,
    bringToFront: bringCardToFront,
    onHeaderPointerDown,
    onHandlePointerDown,
    reset,
    applyDefaultsIfPristine,
    reclamp,
  };
}
