import React from 'react';

export type GlassButtonVariant = 'primary' | 'secondary' | 'forest' | 'ghost';
export type GlassButtonSize = 'sm' | 'md' | 'lg';

interface GlassButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: GlassButtonVariant;
  size?: GlassButtonSize;
  isLoading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
}

// Glass morphism base classes
const glassBase = [
  'relative',
  'overflow-hidden',
  'backdrop-blur-xl',
  'border',
  'rounded-2xl',
  'font-sans',
  'font-medium',
  'transition-all',
  'duration-300',
  'cursor-pointer',
  'inline-flex',
  'items-center',
  'justify-center',
  'gap-2',
  // Glass gradient overlay
  'before:absolute',
  'before:inset-0',
  'before:bg-gradient-to-b',
  'before:from-white/10',
  'before:to-transparent',
  'before:pointer-events-none',
  // Top shine line
  'after:absolute',
  'after:top-0',
  'after:left-1/2',
  'after:-translate-x-1/2',
  'after:w-3/4',
  'after:h-px',
  'after:bg-gradient-to-r',
  'after:from-transparent',
  'after:via-white/30',
  'after:to-transparent',
  'after:pointer-events-none',
];

// Variant classes
const variants: Record<GlassButtonVariant, string[]> = {
  primary: [
    'bg-[#7f9b5a]/20',
    'border-[#7f9b5a]/35',
    'text-[#e8f0d5]',
    'shadow-[0_0_20px_rgba(127, 155, 90,0.18)]',
    'hover:bg-[#7f9b5a]/30',
    'hover:border-[#7f9b5a]/50',
    'hover:shadow-[0_0_30px_rgba(127, 155, 90,0.25)]',
    'active:scale-[0.98]',
  ],
  secondary: [
    'bg-[#5b2c20]/45',
    'border-white/15',
    'text-[#f4efe7]',
    'shadow-[0_0_15px_rgba(0,0,0,0.18)]',
    'hover:bg-[#5b2c20]/60',
    'hover:border-white/25',
    'hover:shadow-[0_0_20px_rgba(0,0,0,0.24)]',
    'active:scale-[0.98]',
  ],
  forest: [
    'bg-[#2f3d20]/78',
    'border-[#7f9b5a]/28',
    'text-[#f4efe7]',
    'shadow-[0_0_18px_rgba(47,61,32,0.2)]',
    'hover:bg-[#2f3d20]/90',
    'hover:border-[#7f9b5a]/38',
    'hover:shadow-[0_0_24px_rgba(47,61,32,0.26)]',
    'active:scale-[0.98]',
  ],
  ghost: [
    'bg-transparent',
    'border-white/10',
    'text-[#d8cbbb]',
    'hover:bg-[#7f9b5a]/10',
    'hover:border-[#7f9b5a]/24',
    'hover:text-[#f4efe7]',
    'active:scale-[0.98]',
  ],
};

// Size classes
const sizes: Record<GlassButtonSize, string> = {
  sm: 'px-4 py-2 text-sm',
  md: 'px-6 py-3 text-base',
  lg: 'px-8 py-4 text-lg',
};

const iconSizes: Record<GlassButtonSize, string> = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
};

export const GlassButton = React.forwardRef<HTMLButtonElement, GlassButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      isLoading = false,
      icon,
      iconPosition = 'left',
      fullWidth = false,
      disabled,
      className = '',
      children,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || isLoading;

    const combinedClasses = [
      ...glassBase,
      ...variants[variant],
      sizes[size],
      fullWidth && 'w-full',
      isDisabled && 'opacity-50 cursor-not-allowed',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <button
        ref={ref}
        className={combinedClasses}
        disabled={isDisabled}
        {...props}
      >
        {isLoading && (
          <svg
            className={`animate-spin ${iconSizes[size]}`}
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        {!isLoading && icon && iconPosition === 'left' && (
          <span className={iconSizes[size]}>{icon}</span>
        )}
        <span>{children}</span>
        {!isLoading && icon && iconPosition === 'right' && (
          <span className={iconSizes[size]}>{icon}</span>
        )}
      </button>
    );
  }
);

GlassButton.displayName = 'GlassButton';

export default GlassButton;
