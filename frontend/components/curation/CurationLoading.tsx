import { Spinner } from '../ui/Spinner';
import { useUiLocale } from '../../lib/uiLocale';

interface CurationLoadingProps {
  selectedLabels: {
    theme: string | null;
    era: string | null;
    emotion: string | null;
  };
  error: { message: string; retryable: boolean } | null;
  onRetry: () => void;
  onEnterDefault: () => void;
}

export const CurationLoading = ({
  selectedLabels,
  error,
  onRetry,
  onEnterDefault,
}: CurationLoadingProps) => {
  const { locale } = useUiLocale();
  const isKorean = locale === 'ko';
  const copy = {
    loadingTitle: isKorean ? '전시를 준비하는 중' : 'Preparing exhibition',
    loadingDesc: isKorean ? '선택한 옵션을 바탕으로 작품을 정렬하고 있습니다.' : 'We are sorting artworks based on your selections.',
    errorTitle: isKorean ? '문제가 발생했습니다' : 'Something went wrong',
    retry: isKorean ? '다시 시도' : 'Try again',
    enterDefault: isKorean ? '기본관람으로 입장' : 'Enter default viewing',
  } as const;

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
        <div className="relative mb-6 w-full max-w-sm overflow-hidden rounded-[24px] border border-[#b57d69]/20 bg-[#1b1812]/86 p-6 text-center backdrop-blur-xl">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(127, 155, 90,0.08),transparent_38%,rgba(91,44,32,0.1)_100%)]" />
          <div className="pointer-events-none absolute left-1/2 top-0 h-px w-1/2 -translate-x-1/2 bg-gradient-to-r from-transparent via-white/20 to-transparent" />

          <div className="relative z-10">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#5b2c20]/24">
              <svg className="h-7 w-7 text-[#d1a293]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 className="mb-2 text-xl font-semibold text-[#f4efe7]">{copy.errorTitle}</h3>
            <p className="mb-6 text-sm text-[#b29e8d]">{error.message}</p>

            <div className="flex flex-col gap-3">
              {error.retryable && (
                <button
                  onClick={onRetry}
                  className="relative w-full overflow-hidden rounded-xl border border-[#7f9b5a]/30 bg-[#7f9b5a]/18 py-3 font-semibold text-[#e8f0d5] transition-all duration-300 hover:border-[#7f9b5a]/45 hover:bg-[#7f9b5a]/26"
                >
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/10 to-transparent" />
                  <span className="relative z-10">{copy.retry}</span>
                </button>
              )}
              <button
                onClick={onEnterDefault}
                className="relative w-full overflow-hidden rounded-xl border border-white/10 bg-[#1b1812]/70 py-3 font-medium text-[#d8cbbb] transition-all duration-300 hover:border-white/20 hover:bg-[#241f18]/80 hover:text-[#f4efe7]"
              >
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/5 to-transparent" />
                <span className="relative z-10">{copy.enterDefault}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
      <div className="mb-6">
        <Spinner size="lg" />
      </div>
      <h3 className="mb-2 text-xl font-semibold text-[#f4efe7]">{copy.loadingTitle}</h3>
      <p className="mb-6 text-sm text-[#b29e8d]">{copy.loadingDesc}</p>

      {/* Glass Tags */}
      <div className="flex flex-wrap justify-center gap-3">
        {selectedLabels.theme && (
          <span className="relative flex items-center gap-2 overflow-hidden rounded-full border border-[#7f9b5a]/20 bg-[#7f9b5a]/10 px-4 py-2 text-sm font-medium text-[#e8f0d5] backdrop-blur-xl">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/5 to-transparent" />
            <svg className="w-4 h-4 relative z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
            </svg>
            <span className="relative z-10">{selectedLabels.theme}</span>
          </span>
        )}
        {selectedLabels.era && (
          <span className="relative flex items-center gap-2 overflow-hidden rounded-full border border-[#b57d69]/20 bg-[#5b2c20]/12 px-4 py-2 text-sm font-medium text-[#f0d7cf] backdrop-blur-xl">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/5 to-transparent" />
            <svg className="w-4 h-4 relative z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="relative z-10">{selectedLabels.era}</span>
          </span>
        )}
        {selectedLabels.emotion && (
          <span className="relative flex items-center gap-2 overflow-hidden rounded-full border border-white/10 bg-[#1b1812]/70 px-4 py-2 text-sm font-medium text-[#d8cbbb] backdrop-blur-xl">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/5 to-transparent" />
            <svg className="w-4 h-4 relative z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
            <span className="relative z-10">{selectedLabels.emotion}</span>
          </span>
        )}
      </div>
    </div>
  );
};

export default CurationLoading;
