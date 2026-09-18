import type { CurationOption } from '../../types/curation';

interface OptionCardProps {
  option: CurationOption;
  isSelected: boolean;
  onClick: () => void;
  testId?: string;
}

export const OptionCard = ({ option, isSelected, onClick, testId }: OptionCardProps) => {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      className={[
        'w-full text-left',
        'relative overflow-hidden backdrop-blur-xl border rounded-2xl transition-all duration-300',
        // Glass gradient overlay
        'before:absolute before:inset-0 before:bg-gradient-to-b before:from-white/5 before:to-transparent before:pointer-events-none',
        // Top shine line
        'after:absolute after:top-0 after:left-1/2 after:-translate-x-1/2 after:w-1/2 after:h-px after:bg-gradient-to-r after:from-transparent after:via-white/20 after:to-transparent after:pointer-events-none',
        // Base styles
        'p-4',
        isSelected
          ? 'bg-[linear-gradient(180deg,rgba(127, 155, 90,0.18),rgba(27,24,18,0.92))] border-[#7f9b5a]/40 shadow-[0_0_30px_rgba(127, 155, 90,0.16)]'
          : 'bg-[#1b1812]/55 border-white/10 hover:bg-[#241f18]/80 hover:border-white/20 hover:shadow-[0_0_20px_rgba(0,0,0,0.18)]',
        'active:scale-[0.98]',
        'cursor-pointer',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="relative z-10 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <h4
              className={`font-sans font-medium leading-tight ${
                isSelected ? 'text-[#f4efe7]' : 'text-[#f4efe7]'
              }`}
            >
              {option.labelKo}
            </h4>
            {option.yearRangeLabel ? (
              <span
                className={`font-sans rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest ${
                  isSelected ? 'bg-[#7f9b5a]/15 text-[#e8f0d5]' : 'bg-white/5 text-[#b29e8d]'
                }`}
              >
                {option.yearRangeLabel}
              </span>
            ) : null}
          </div>
          <p
            className={`font-sans text-sm font-light line-clamp-2 leading-relaxed ${
              isSelected ? 'text-[#d8cbbb]' : 'text-[#b29e8d]'
            }`}
          >
            {option.displayDescription}
          </p>
        </div>
        {isSelected && (
          <div className="flex-shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-[#7f9b5a] shadow-[0_0_10px_rgba(127, 155, 90,0.28)]">
            <svg
              className="w-4 h-4 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
        )}
      </div>
    </button>
  );
};

export default OptionCard;
