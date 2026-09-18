import { useEffect } from 'react';

let activeModalCount = 0;
let savedBodyCursor = '';
let savedRootCursor = '';

const setDefaultCursor = () => {
  document.body.style.cursor = 'default';
  document.documentElement.style.cursor = 'default';
};

const restoreCursor = () => {
  document.body.style.cursor = savedBodyCursor;
  document.documentElement.style.cursor = savedRootCursor;
};

export const useModalPointerPolicy = (active: boolean) => {
  useEffect(() => {
    if (!active || typeof document === 'undefined') {
      return;
    }

    const wasIdle = activeModalCount === 0;
    activeModalCount += 1;

    if (wasIdle) {
      savedBodyCursor = document.body.style.cursor;
      savedRootCursor = document.documentElement.style.cursor;
      if (document.pointerLockElement) {
        try {
          document.exitPointerLock();
        } catch {
          // Ignore pointer lock release failures and keep the modal cursor policy active.
        }
      }
    }

    setDefaultCursor();

    return () => {
      activeModalCount = Math.max(0, activeModalCount - 1);

      if (activeModalCount === 0) {
        restoreCursor();
        savedBodyCursor = '';
        savedRootCursor = '';
        return;
      }

      setDefaultCursor();
    };
  }, [active]);
};
