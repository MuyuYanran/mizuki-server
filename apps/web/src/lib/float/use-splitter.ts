/**
 * [UI-U2 / T4] 编辑器侧栏宽度拖拽调整与持久化 Composable
 * 钳制范围 [240, 480]，ESC 回弹，<1280px 降级回退固定 320px。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

export interface UseSplitterOptions {
  storageKey: string;
  defaultWidth?: number; // 默认 320
  min?: number;          // 默认 240
  max?: number;          // 默认 480
}

interface SplitterStoragePayload {
  version: 1;
  sidebar: number;
}

export function useSplitter(options: UseSplitterOptions) {
  const minW = options.min ?? 240;
  const maxW = options.max ?? 480;
  const defW = options.defaultWidth ?? 320;

  function readStoredWidth(): number {
    try {
      const raw = localStorage.getItem(options.storageKey);
      if (!raw) return defW;
      const parsed = JSON.parse(raw) as SplitterStoragePayload;
      if (parsed && parsed.version === 1 && typeof parsed.sidebar === 'number') {
        return Math.max(minW, Math.min(maxW, parsed.sidebar));
      }
      return defW;
    } catch {
      return defW;
    }
  }

  function writeStoredWidth(width: number): void {
    try {
      const payload: SplitterStoragePayload = {
        version: 1,
        sidebar: width,
      };
      localStorage.setItem(options.storageKey, JSON.stringify(payload));
    } catch {
      // 容错
    }
  }

  const rawWidth = ref(readStoredWidth());
  const isDragging = ref(false);
  const isWide = ref(typeof window !== 'undefined' ? window.innerWidth >= 1280 : true);

  function checkWidth(): void {
    if (typeof window !== 'undefined') {
      isWide.value = window.innerWidth >= 1280;
    }
  }

  onMounted(() => {
    checkWidth();
    window.addEventListener('resize', checkWidth);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('resize', checkWidth);
  });

  // K5：窄视口（<1280px）回退固定 320px
  const width = computed(() => (isWide.value ? rawWidth.value : 320));

  let startX = 0;
  let startWidth = 0;
  let snapshotWidth = 0;
  let activePointerId: number | null = null;
  let activeElement: HTMLElement | null = null;

  function onPointerDown(e: PointerEvent): void {
    if (!isWide.value || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    isDragging.value = true;
    startX = e.clientX;
    startWidth = rawWidth.value;
    snapshotWidth = rawWidth.value;
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

  function onPointerMove(e: PointerEvent): void {
    if (!isDragging.value) return;
    // 侧栏在右侧，向左拖动（dx < 0）意味着侧栏变宽（newWidth = startWidth - dx）
    const dx = e.clientX - startX;
    const newW = Math.max(minW, Math.min(maxW, startWidth - dx));
    rawWidth.value = newW;
  }

  function finishDrag(save: boolean): void {
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

    if (save && isDragging.value) {
      writeStoredWidth(rawWidth.value);
    }

    isDragging.value = false;
    activePointerId = null;
    activeElement = null;
  }

  function onPointerUp(): void {
    finishDrag(true);
  }

  function onPointerCancel(): void {
    rawWidth.value = snapshotWidth;
    finishDrag(false);
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && isDragging.value) {
      e.preventDefault();
      rawWidth.value = snapshotWidth;
      finishDrag(false);
    }
  }

  onBeforeUnmount(() => {
    finishDrag(false);
  });

  return {
    width,
    isDragging,
    isWide,
    onPointerDown,
  };
}
