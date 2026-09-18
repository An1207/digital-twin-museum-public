import { useSyncExternalStore } from 'react';

export type UiLocale = 'ko' | 'en';

const STORAGE_KEY = 'digital-twin-ui-locale';

export const getLocaleLabel = (locale: UiLocale) => (locale === 'ko' ? '한국어' : 'English');

const getInitialLocale = (): UiLocale => {
  if (typeof window === 'undefined') return 'ko';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'en' ? 'en' : 'ko';
};

let currentLocale: UiLocale = getInitialLocale();
const listeners = new Set<() => void>();

const syncDocumentLocale = (locale: UiLocale) => {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
  }
};

const syncStorage = (locale: UiLocale) => {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, locale);
  }
};

const emitChange = () => {
  for (const listener of listeners) {
    listener();
  }
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => currentLocale;

export const setGlobalLocale = (locale: UiLocale) => {
  if (locale === currentLocale) return;
  currentLocale = locale;
  syncStorage(locale);
  syncDocumentLocale(locale);
  emitChange();
};

export const useUiLocale = () => {
  const locale = useSyncExternalStore<UiLocale>(subscribe, getSnapshot, () => 'ko');
  return { locale, setLocale: setGlobalLocale };
};

syncDocumentLocale(currentLocale);
