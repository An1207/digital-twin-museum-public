import { useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCurationStore } from '../../hooks/useCurationStore';
import { useUiLocale } from '../../lib/uiLocale';
import { useModalPointerPolicy } from '../../lib/useModalPointerPolicy';
import { AxisSection } from './AxisSection';
import { CurationLoading } from './CurationLoading';
import { Toast } from '../ui/Toast';
import { isSelectionComplete, getUnselectedCount } from '../../types/curation';

export const CurationModal = () => {
  const {
    modalState,
    axes,
    selection,
    error,
    closeModal,
    openAxisSelection,
    selectOption,
    submitSelection,
    retry,
    enterDefaultGallery,
    setError,
  } = useCurationStore();
  const { locale } = useUiLocale();
  const isKorean = locale === 'ko';

  // ESC key to close
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (modalState === 'AXIS_SELECTION' || modalState === 'ENTRY_SELECTION')) {
        closeModal();
      }
    },
    [modalState, closeModal]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useModalPointerPolicy(modalState !== 'CLOSED');

  // Body scroll lock when modal opens
  useEffect(() => {
    if (modalState !== 'CLOSED') {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [modalState]);

  if (modalState === 'CLOSED') {
    return null;
  }

  const selectionComplete = isSelectionComplete(selection);
  const unselectedCount = getUnselectedCount(selection);

  const getSelectedLabel = (category: 'theme' | 'era' | 'emotion'): string | null => {
    const categoryAxes = axes.find((a) => a.category === category);
    if (!categoryAxes) return null;
    const optionId = selection[`${category}OptionId`];
    if (optionId === null) return null;
    const option = categoryAxes.options.find((o) => o.id === optionId);
    return option?.labelKo || null;
  };

  return (
    <div data-testid="curation-modal" className="fixed inset-0 z-[210] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(127, 155, 90,0.14),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(91,44,32,0.12),transparent_30%),linear-gradient(180deg,rgba(17,15,12,0.88),rgba(17,15,12,0.94))] backdrop-blur-md"
        onClick={modalState === 'AXIS_SELECTION' ? closeModal : undefined}
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="relative w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-[32px] border border-white/10 bg-[#1b1812]/96 shadow-[0_30px_90px_rgba(0,0,0,0.56)] backdrop-blur-2xl"
      >
        <div className="relative overflow-hidden border-b border-white/10 px-6 py-4 sm:px-7 sm:py-5">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(127, 155, 90,0.08),transparent_35%,rgba(91,44,32,0.08)_100%)]" />
          <div className="pointer-events-none absolute left-1/2 top-0 h-px w-3/4 -translate-x-1/2 bg-gradient-to-r from-transparent via-white/30 to-transparent" />

          <div className="relative z-10 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#7f9b5a]">
                {modalState === 'ENTRY_SELECTION'
                  ? (isKorean ? '관람 모드 선택' : 'Choose viewing mode')
                  : (isKorean ? '관람 옵션 선택' : 'Choose viewing options')}
              </p>
              <h2 className="mt-2 font-display text-2xl font-normal tracking-normal text-[#f4efe7]">
                {modalState === 'ENTRY_SELECTION'
                  ? (isKorean ? '기본관람 / 취향 선택' : 'Default / Preference selection')
                  : (isKorean ? '관람 옵션 선택' : 'Choose viewing options')}
              </h2>
              <p className="mt-2 max-w-2xl font-sans text-sm font-light leading-relaxed text-[#b29e8d]">
                {modalState === 'ENTRY_SELECTION'
                  ? (isKorean
                      ? '저장된 구성으로 바로 입장하거나, 옵션을 고른 뒤 선택한 공간의 슬롯 수에 맞춰 다시 배치된 작품으로 입장합니다.'
                      : 'Enter with the saved arrangement, or choose options to re-enter with artworks reordered to match the selected space slots.')
                  : (isKorean
                      ? '세 가지 옵션을 모두 고르면 작품이 유사도 순으로 정렬됩니다.'
                      : 'Pick all three options to sort artworks by similarity.')}
              </p>
            </div>
            {(modalState === 'AXIS_SELECTION' || modalState === 'ENTRY_SELECTION') && (
              <button
                data-testid="curation-close"
                onClick={closeModal}
                className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/5 text-[#b29e8d] transition-all duration-300 hover:border-white/20 hover:bg-white/10 hover:text-[#f4efe7]"
              >
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/5 to-transparent" />
                <svg className="w-5 h-5 relative z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <div className="max-h-[calc(90vh-140px)] overflow-y-auto p-6 sm:p-7">
          <AnimatePresence mode="wait">
            {modalState === 'ENTRY_SELECTION' && (
              <motion.div
                key="entry-selection"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="grid grid-cols-1 gap-5 md:grid-cols-2"
              >
                <motion.button
                  data-testid="entry-default-gallery"
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={enterDefaultGallery}
                  className="group relative overflow-hidden rounded-[28px] border border-[#7f9b5a]/28 bg-[linear-gradient(180deg,rgba(127, 155, 90,0.16),rgba(27,24,18,0.88))] p-6 text-left transition-all duration-300 hover:-translate-y-0.5 hover:border-[#7f9b5a]/45 hover:bg-[linear-gradient(180deg,rgba(127, 155, 90,0.22),rgba(27,24,18,0.94))]"
                >
                  <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(127, 155, 90,0.08),transparent_42%,rgba(91,44,32,0.08)_100%)]" />
                  <div className="relative z-10">
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-[#7f9b5a]/20 bg-[#7f9b5a]/12 text-[#e8f0d5] transition group-hover:bg-[#7f9b5a]/18">
                      <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                    </div>
                    <h3 className="mb-2 font-display text-xl font-normal tracking-normal text-[#f4efe7]">
                      {isKorean ? '기본관람' : 'Default viewing'}
                    </h3>
                    <p className="mb-4 font-sans text-sm font-light leading-relaxed text-[#b29e8d]">
                      {isKorean
                        ? '저장된 공간 구성을 그대로 불러와 바로 입장합니다.'
                        : 'Enter immediately with the saved space layout.'}
                    </p>
                    <span className="font-sans text-sm font-medium text-[#e8f0d5]">
                      {isKorean ? '기본관람 시작' : 'Start default viewing'}
                    </span>
                  </div>
                </motion.button>

                <motion.button
                  data-testid="entry-selection-gallery"
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={() => void openAxisSelection()}
                  className="group relative overflow-hidden rounded-[28px] border border-[#b57d69]/28 bg-[linear-gradient(180deg,rgba(91,44,32,0.22),rgba(27,24,18,0.92))] p-6 text-left transition-all duration-300 hover:-translate-y-0.5 hover:border-[#b57d69]/45 hover:bg-[linear-gradient(180deg,rgba(91,44,32,0.3),rgba(27,24,18,0.96))]"
                >
                  <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(91,44,32,0.1),transparent_42%,rgba(127, 155, 90,0.08)_100%)]" />
                  <div className="relative z-10">
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-[#b57d69]/20 bg-[#5b2c20]/18 text-[#f0d7cf] transition group-hover:bg-[#5b2c20]/28">
                      <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                      </svg>
                    </div>
                    <h3 className="mb-2 font-display text-xl font-normal tracking-normal text-[#f4efe7]">
                      {isKorean ? '취향 선택' : 'Preference selection'}
                    </h3>
                    <p className="mb-4 font-sans text-sm font-light leading-relaxed text-[#b29e8d]">
                      {isKorean
                        ? '테마, 시대, 감정을 고른 뒤 선택한 공간 슬롯 수에 맞춰 유사도 순 작품으로 입장합니다.'
                        : 'Choose theme, era, and emotion to enter the selected space with similarity-ranked artworks.'}
                    </p>
                    <span className="font-sans text-sm font-medium text-[#f0d7cf]">
                      {isKorean ? '취향 선택 시작' : 'Start preference selection'}
                    </span>
                  </div>
                </motion.button>
              </motion.div>
            )}

            {modalState === 'AXIS_SELECTION' && (
              <motion.div
                key="selection"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                data-testid="curation-axis-selection"
              >
                {/* Axis Sections */}
                {axes.length > 0 ? (
                  axes.map((axis) => (
                    <AxisSection
                      key={axis.category}
                      axis={axis}
                      selectedOptionId={selection[`${axis.category}OptionId`]}
                      onSelect={(optionId) => selectOption(axis.category, optionId)}
                    />
                  ))
                ) : (
                  <div className="flex items-center justify-center py-12">
                    <div className="text-stone-400">Loading options...</div>
                  </div>
                )}

                {/* CTA */}
                <div className="mt-8 border-t border-white/10 pt-6">
                  {!selectionComplete && (
                    <p className="mb-4 text-center font-sans text-sm font-light leading-relaxed text-[#b29e8d]">
                      {isKorean ? `${unselectedCount}개 더 선택해야 합니다` : `${unselectedCount} more to select`}
                    </p>
                  )}
                  <button
                    data-testid="curation-submit"
                    disabled={!selectionComplete}
                    onClick={submitSelection}
                    className={[
                      'relative w-full overflow-hidden rounded-2xl border py-4 text-lg font-semibold transition-all duration-300 backdrop-blur-xl',
                      selectionComplete
                        ? [
                            'border-[#7f9b5a]/35 bg-[#7f9b5a]/18 text-[#e8f0d5]',
                            'hover:border-[#7f9b5a]/50 hover:bg-[#7f9b5a]/26',
                            'shadow-[0_0_30px_rgba(127, 155, 90,0.18)]',
                            'before:pointer-events-none before:absolute before:inset-0 before:bg-gradient-to-b before:from-white/10 before:to-transparent',
                          ].join(' ')
                        : 'cursor-not-allowed border-white/10 bg-[#1b1812]/60 text-[#b29e8d]',
                    ].join(' ')}
                  >
                    <span className="relative z-10">
                      {selectionComplete
                        ? (isKorean ? '이 선택으로 관람 시작' : 'Enter with this selection')
                        : (isKorean ? '모든 옵션을 선택하세요' : 'Please select all options')}
                    </span>
                  </button>
                </div>
              </motion.div>
            )}

            {modalState === 'LOADING' && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <CurationLoading
                  selectedLabels={{
                    theme: getSelectedLabel('theme'),
                    era: getSelectedLabel('era'),
                    emotion: getSelectedLabel('emotion'),
                  }}
                  error={error}
                  onRetry={retry}
                  onEnterDefault={enterDefaultGallery}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Bottom shine */}
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-3/4 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent pointer-events-none" />
      </motion.div>

      {/* Error Toast */}
      {error && (
        <Toast
          message={error.message}
          type="error"
          onClose={() => setError(null)}
        />
      )}
    </div>
  );
};
