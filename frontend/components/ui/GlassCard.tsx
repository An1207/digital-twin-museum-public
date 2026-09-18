import React from 'react';

export type GlassCardVariant = 'default' | 'selected' | 'interactive';

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: GlassCardVariant;
  selected?: boolean;
  interactive?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

// Glass card base styles
const glassCardBase = [
  'relative',
  'overflow-hidden',
  'backdrop-blur-xl',
  'border',
  'rounded-2xl',
  'transition-all',
  'duration-300',
  // Glass gradient overlay
  'before:absolute',
  'before:inset-0',
  'before:bg-gradient-to-b',
  'before:from-white/5',
  'before:to-transparent',
  'before:pointer-events-none',
  // Top shine line
  'after:absolute',
  'after:top-0',
  'after:left-1/2',
  'after:-translate-x-1/2',
  'after:w-1/2',
  'after:h-px',
  'after:bg-gradient-to-r',
  'after:from-transparent',
  'after:via-white/20',
  'after:to-transparent',
  'after:pointer-events-none',
];

// Variant styles
const variants: Record<GlassCardVariant, string[]> = {
  default: [
    'bg-[#1b1812]/82',
    'border-white/10',
  ],
  selected: [
    'bg-[#2f3d20]/50',
    'border-[#7f9b5a]/35',
    'shadow-[0_0_30px_rgba(127, 155, 90,0.14)]',
  ],
  interactive: [
    'bg-[#1b1812]/72',
    'border-white/10',
    'hover:bg-[#5b2c20]/42',
    'hover:border-[#7f9b5a]/26',
    'hover:shadow-[0_0_20px_rgba(127, 155, 90,0.08)]',
    'cursor-pointer',
    'active:scale-[0.98]',
  ],
};

// Padding sizes
const paddingSizes = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

export const GlassCard = React.forwardRef<HTMLDivElement, GlassCardProps>(
  (
    {
      variant = 'default',
      selected = false,
      interactive = false,
      padding = 'md',
      className = '',
      children,
      ...props
    },
    ref
  ) => {
    const effectiveVariant: GlassCardVariant = selected ? 'selected' : variant;

    const combinedClasses = [
      ...glassCardBase,
      variants[effectiveVariant],
      paddingSizes[padding],
      interactive && !selected && variants.interactive,
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div ref={ref} className={combinedClasses} {...props}>
        {children}
      </div>
    );
  }
);

GlassCard.displayName = 'GlassCard';

// Option card specific export
export const GlassOptionCard = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    isSelected?: boolean;
    title: string;
    description?: string;
    icon?: React.ReactNode;
  }
>(({ isSelected, title, description, icon, className, ...props }, ref) => {
  return (
    <button
      ref={ref}
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
          ? 'bg-[#2f3d20]/48 border-[#7f9b5a]/35 shadow-[0_0_30px_rgba(127, 155, 90,0.14)]'
          : 'bg-[#1b1812]/78 border-white/10 hover:bg-[#5b2c20]/40 hover:border-[#7f9b5a]/24 hover:shadow-[0_0_20px_rgba(127, 155, 90,0.06)]',
        'active:scale-[0.98]',
        'cursor-pointer',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      <div className="relative z-10 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {icon && (
            <div className={`mb-2 ${isSelected ? 'text-[#e8f0d5]' : 'text-[#b29e8d]'}`}>
              {icon}
            </div>
          )}
          <h4
            className={`font-sans font-medium mb-1 leading-tight ${
              isSelected ? 'text-[#f4efe7]' : 'text-[#f4efe7]'
            }`}
          >
            {title}
          </h4>
          {description && (
            <p
              className={`text-sm line-clamp-2 leading-relaxed ${
                isSelected ? 'text-[#e8f0d5]/82' : 'text-[#d8cbbb]'
              }`}
            >
              {description}
            </p>
          )}
        </div>
        {isSelected && (
          <div className="flex-shrink-0 w-6 h-6 rounded-full bg-[#7f9b5a] flex items-center justify-center shadow-[0_0_10px_rgba(127, 155, 90,0.28)]">
            <svg
              className="w-4 h-4 text-[#14130c]"
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
});

GlassOptionCard.displayName = 'GlassOptionCard';

export default GlassCard;
