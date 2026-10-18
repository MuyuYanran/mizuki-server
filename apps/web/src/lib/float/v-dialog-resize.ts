/**
 * [UI-U2 / T2 / K2] el-dialog 宽度缩放指令与全局监控
 * 兼容 Vue 3 组件 Teleport 占位符与 Comment 节点。
 */
import type { Directive } from 'vue';

function initHandles(dialog: HTMLElement): () => void {
  if (dialog.querySelector('.dialog-resize-handle')) {
    return () => {};
  }

  const handleE = document.createElement('div');
  handleE.className = 'dialog-resize-handle dialog-resize-handle--e';

  const handleSE = document.createElement('div');
  handleSE.className = 'dialog-resize-handle dialog-resize-handle--se';

  dialog.appendChild(handleE);
  dialog.appendChild(handleSE);

  let startX = 0;
  let startW = 0;
  let activeHandle: HTMLElement | null = null;
  let activePointerId: number | null = null;

  const onPointerMove = (e: PointerEvent) => {
    if (!activeHandle) return;
    const dx = e.clientX - startX;
    const maxW = Math.max(360, window.innerWidth - 32);
    const newW = Math.max(360, Math.min(maxW, startW + dx));
    dialog.style.width = `${newW}px`;
  };

  const onPointerUp = () => {
    if (activePointerId !== null && activeHandle) {
      try {
        if (activeHandle.hasPointerCapture(activePointerId)) {
          activeHandle.releasePointerCapture(activePointerId);
        }
      } catch {
        // 容错
      }
    }
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    activeHandle = null;
    activePointerId = null;
    dialog.classList.remove('is-dialog-resizing');
  };

  const startResize = (handle: HTMLElement, e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    startX = e.clientX;
    startW = dialog.getBoundingClientRect().width;
    activeHandle = handle;
    activePointerId = e.pointerId;

    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // 容错
    }

    dialog.classList.add('is-dialog-resizing');
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  const onDownE = (e: PointerEvent) => startResize(handleE, e);
  const onDownSE = (e: PointerEvent) => startResize(handleSE, e);

  handleE.addEventListener('pointerdown', onDownE);
  handleSE.addEventListener('pointerdown', onDownSE);

  return () => {
    handleE.removeEventListener('pointerdown', onDownE);
    handleSE.removeEventListener('pointerdown', onDownSE);
    handleE.remove();
    handleSE.remove();
  };
}

export function setupDialogResizeObserver(): void {
  if (typeof document === 'undefined') return;

  const attachAll = () => {
    const dialogs = document.querySelectorAll('.el-dialog');
    dialogs.forEach((d) => {
      if (d instanceof HTMLElement && !d.querySelector('.dialog-resize-handle')) {
        initHandles(d);
      }
    });
  };

  attachAll();

  const observer = new MutationObserver(() => {
    attachAll();
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

export const vDialogResize: Directive = {
  mounted() {
    setupDialogResizeObserver();
  },
  updated() {
    setupDialogResizeObserver();
  },
};
