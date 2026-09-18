import { motion } from 'framer-motion';
import { useCurationStore } from '../../hooks/useCurationStore';
import { useModalPointerPolicy } from '../../lib/useModalPointerPolicy';

interface EntranceModeSelectionProps {
  onClose: () => void;
  onGeneralUserEntry: () => void;
  onAuthorEntry: () => void;
  canAuthorEntry: boolean;
}

export const EntranceModeSelection = ({
  onClose,
  onGeneralUserEntry,
  onAuthorEntry,
  canAuthorEntry,
}: EntranceModeSelectionProps) => {
  const { openModal } = useCurationStore();

  useModalPointerPolicy(true);

  const handleGeneralUser = () => {
    onClose();
    onGeneralUserEntry();
    void openModal();
  };

  const handleAuthorEntry = () => {
    onClose();
    onAuthorEntry();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      {/* Glass Overlay */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Glass Modal Panel */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="relative w-full max-w-2xl p-8 overflow-hidden bg-stone-900/80 backdrop-blur-xl border border-white/10 rounded-3xl shadow-[0_0_60px_rgba(0,0,0,0.5)]"
      >
        {/* Glass gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none" />
        {/* Top shine */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent pointer-events-none" />
        {/* Bottom shine */}
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1/2 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-20 w-10 h-10 rounded-xl backdrop-blur-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 transition-all duration-300 flex items-center justify-center text-stone-400 hover:text-stone-200"
        >
          <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none" />
          <svg className="w-5 h-5 relative z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Header */}
        <div className="relative z-10 mb-7">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#7f9b5a]">
            관람 모드
          </p>
          <h2 className="mt-2 font-display text-2xl font-normal tracking-normal text-stone-100">
            입장 방식을 선택하세요
          </h2>
        </div>

        {/* Two Options */}
        <div className={`relative z-10 grid grid-cols-1 gap-6 ${canAuthorEntry ? 'md:grid-cols-2' : ''}`}>
          {/* Default Gallery */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleGeneralUser}
            className="group relative p-6 rounded-2xl overflow-hidden backdrop-blur-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 transition-all duration-300 text-left"
          >
            {/* Glass overlay */}
            <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none" />
            {/* Top shine */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />

            <div className="relative z-10">
              <div className="w-12 h-12 rounded-xl bg-stone-800/50 backdrop-blur flex items-center justify-center mb-4 group-hover:bg-amber-500/20 transition-colors">
                <svg className="w-6 h-6 text-stone-400 group-hover:text-amber-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <h3 className="mb-2 font-display text-lg font-normal tracking-normal text-stone-100">기본관람</h3>
              <p className="mb-4 font-sans text-sm font-light leading-relaxed text-stone-400">
                저장된 공간 배치 그대로 입장합니다.
              </p>
              <div className="font-sans text-sm font-medium text-amber-400">
                기본관람 시작
                <svg className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </motion.button>

          {canAuthorEntry ? (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleAuthorEntry}
              className="group relative p-6 rounded-2xl overflow-hidden backdrop-blur-xl border border-amber-400/20 bg-amber-500/10 hover:bg-amber-500/15 hover:border-amber-400/30 transition-all duration-300 text-left"
            >
              {/* Glass overlay */}
              <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none" />
              {/* Top shine */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-px bg-gradient-to-r from-transparent via-amber-400/30 to-transparent pointer-events-none" />

              <div className="relative z-10">
                <div className="w-12 h-12 rounded-xl bg-amber-500/20 backdrop-blur flex items-center justify-center mb-4 group-hover:bg-amber-500/30 transition-colors">
                  <svg className="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                  </svg>
                </div>
                <h3 className="mb-2 font-display text-lg font-normal tracking-normal text-stone-100">맞춤 관람</h3>
                <p className="mb-4 font-sans text-sm font-light leading-relaxed text-stone-400">
                  옵션을 선택해 유사도 순으로 다시 감상합니다.
                </p>
                <div className="font-sans text-sm font-medium text-amber-400">
                  맞춤 관람 시작
                  <svg className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </motion.button>
          ) : null}
        </div>
      </motion.div>
    </div>
  );
};

export default EntranceModeSelection;
