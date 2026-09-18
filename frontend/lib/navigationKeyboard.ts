export type ArrowNavigationCode = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

const ARROW_NAVIGATION_CODES: ArrowNavigationCode[] = [
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
];

export const isArrowNavigationCode = (code: string): code is ArrowNavigationCode => {
  return ARROW_NAVIGATION_CODES.includes(code as ArrowNavigationCode);
};

export const isTextInputElement = (element: Element | null) => {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const tagName = element.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || element.isContentEditable;
};

const isIgnoredNavigationRoot = (element: Element | null) => {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  return Boolean(element.closest('[data-keyboard-navigation="ignore"]'));
};

export const shouldIgnoreKeyboardNavigation = (event: KeyboardEvent) => {
  const activeElement = document.activeElement;
  const target = event.target instanceof Element ? event.target : null;

  return (
    isTextInputElement(activeElement) ||
    isIgnoredNavigationRoot(activeElement) ||
    isIgnoredNavigationRoot(target) ||
    event.defaultPrevented
  );
};
