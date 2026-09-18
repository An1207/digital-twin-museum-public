import { create } from 'zustand';
import type { SelectionState, CurationAxis, LayoutResponse, PublishedSpaceDetail, Placement } from '../types/curation';
import { apiService } from '../lib/api';

type ModalState = 'CLOSED' | 'ENTRY_SELECTION' | 'AXIS_SELECTION' | 'LOADING' | '3D_VIEWER';

interface CurationError {
  message: string;
  retryable: boolean;
}

interface CurationState {
  // Modal State
  modalState: ModalState;
  setModalState: (state: ModalState) => void;

  // Axes Data
  axes: CurationAxis[];
  setAxes: (axes: CurationAxis[]) => void;

  // Selection State (3개 조합)
  selection: SelectionState;
  selectOption: (category: 'theme' | 'era' | 'emotion', optionId: number) => void;
  clearSelection: () => void;

  // Loading/Error
  isLoading: boolean;
  error: CurationError | null;
  setError: (error: CurationError | null) => void;

  // Layout Result
  layout: LayoutResponse | null;
  setLayout: (layout: LayoutResponse | null) => void;

  // Selection target when entering from a public space
  selectionTargetSpace: PublishedSpaceDetail | null;
  setSelectionTargetSpace: (space: PublishedSpaceDetail | null) => void;

  // Actions
  openModal: () => void;
  openAxisSelection: () => Promise<void>;
  closeModal: () => void;
  submitSelection: () => Promise<void>;
  retry: () => Promise<void>;
  enterDefaultGallery: () => void;
}

const initialSelection: SelectionState = {
  themeOptionId: null,
  eraOptionId: null,
  emotionOptionId: null,
};

const sortPlacementsBySlot = (placements: Placement[]) =>
  [...placements].sort((left, right) => left.slotNumber - right.slotNumber || left.sortValue - right.sortValue);

const buildSelectionSpaceLayout = (
  selectionLayout: LayoutResponse,
  targetSpace: PublishedSpaceDetail,
): LayoutResponse => {
  const targetLayout = targetSpace.viewerLayout;
  const targetPlacements = sortPlacementsBySlot(targetLayout.placements);
  const rankedPlacements = sortPlacementsBySlot(selectionLayout.placements);
  const placementCount = Math.min(targetPlacements.length, rankedPlacements.length);

  return {
    ...targetLayout,
    layoutType: 'public_space',
    themeOption: selectionLayout.themeOption,
    eraOption: selectionLayout.eraOption,
    emotionOption: selectionLayout.emotionOption,
    placements: targetPlacements.slice(0, placementCount).map((slotPlacement, index) => ({
      ...slotPlacement,
      artwork: rankedPlacements[index].artwork,
    })),
    presentationMode: 'sequential',
  };
};

export const useCurationStore = create<CurationState>((set, get) => ({
  // Modal State
  modalState: 'CLOSED',
  setModalState: (modalState) => set({ modalState }),

  // Axes Data
  axes: [],
  setAxes: (axes) => set({ axes }),

  // Selection State
  selection: { ...initialSelection },
  selectOption: (category, optionId) =>
    set((state) => ({
      selection: {
        ...state.selection,
        [`${category}OptionId`]: optionId,
      },
    })),
  clearSelection: () => set({ selection: { ...initialSelection } }),

  // Loading/Error
  isLoading: false,
  error: null,
  setError: (error) => set({ error }),

  // Layout Result
  layout: null,
  setLayout: (layout) => set({ layout }),

  // Selection target
  selectionTargetSpace: null,
  setSelectionTargetSpace: (selectionTargetSpace) => set({ selectionTargetSpace }),

  // Actions
  openModal: async () => {
    set({
      modalState: 'ENTRY_SELECTION',
      error: null,
      selectionTargetSpace: null,
    });
  },

  openAxisSelection: async () => {
    set({ modalState: 'AXIS_SELECTION', error: null });

    // 이미 axes가 있으면 패치 안함
    const { axes } = get();
    if (axes.length > 0) return;

    try {
      const response = await apiService.getCurationOptions();
      set({ axes: response.axes });
    } catch (err) {
      set({
        error: {
          message: '옵션 정보를 불러오지 못했습니다.',
          retryable: true,
        },
        modalState: 'ENTRY_SELECTION',
      });
    }
  },

  closeModal: () => {
    set({
      modalState: 'CLOSED',
      error: null,
      selectionTargetSpace: null,
    });
  },

  submitSelection: async () => {
    const { selection } = get();

    if (
      selection.themeOptionId === null ||
      selection.eraOptionId === null ||
      selection.emotionOptionId === null
    ) {
      return;
    }

    set({ modalState: 'LOADING', isLoading: true, error: null });

    try {
      const layout = await apiService.getLayout({
        themeOptionId: selection.themeOptionId,
        eraOptionId: selection.eraOptionId,
        emotionOptionId: selection.emotionOptionId,
        sessionId: apiService.getSessionId(),
      });

      const { selectionTargetSpace } = get();
      const nextLayout = selectionTargetSpace
        ? buildSelectionSpaceLayout(layout, selectionTargetSpace)
        : {
            ...layout,
            presentationMode: 'immediate' as const,
          };

      set({
        layout: nextLayout,
        modalState: '3D_VIEWER',
        isLoading: false,
        selectionTargetSpace: null,
      });
    } catch (err: unknown) {
      const error = err as { message?: string; retryable?: boolean };
      set({
        error: {
          message: error?.message || '배치 정보를 불러오지 못했습니다.',
          retryable: error?.retryable ?? true,
        },
        modalState: 'AXIS_SELECTION',
        isLoading: false,
      });
    }
  },

  retry: async () => {
    const { error } = get();
    if (error?.retryable) {
      await get().submitSelection();
    }
  },

  enterDefaultGallery: async () => {
    // 기본 갤러리로 진입 (API 호출)
    set({ modalState: 'LOADING', isLoading: true, error: null });

    try {
      const layout = await apiService.getDefaultLayout();
      set({
        layout: {
          ...layout,
          presentationMode: 'immediate',
        },
        modalState: '3D_VIEWER',
        isLoading: false,
        selectionTargetSpace: null,
      });
    } catch (err: unknown) {
      const error = err as { message?: string; retryable?: boolean };
      set({
        error: {
          message: error?.message || '기본 전시 정보를 불러오지 못했습니다.',
          retryable: true,
        },
        modalState: 'ENTRY_SELECTION',
        isLoading: false,
      });
    }
  },
}));
