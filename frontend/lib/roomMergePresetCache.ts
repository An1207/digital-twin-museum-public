import type { RoomMergePresetResponse } from '../types/curation';

const CACHE_PREFIX = 'digital-twin-room-merge-preset:';

const getCacheKey = (presetId: number) => `${CACHE_PREFIX}${presetId}`;

const safeRead = (presetId: number): RoomMergePresetResponse | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(getCacheKey(presetId));
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as RoomMergePresetResponse;
  } catch {
    return null;
  }
};

export const cacheRoomMergePreset = (preset: RoomMergePresetResponse) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.sessionStorage.setItem(getCacheKey(preset.id), JSON.stringify(preset));
  } catch {
    // Ignore storage quota / privacy mode errors.
  }
};

export const readCachedRoomMergePreset = (presetId: number) => safeRead(presetId);

export const clearCachedRoomMergePreset = (presetId: number) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.sessionStorage.removeItem(getCacheKey(presetId));
  } catch {
    // Ignore storage failures.
  }
};

