import { ButtonHTMLAttributes, forwardRef } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className = '', children, disabled, ...props }, ref) => {
    const baseClasses =
      'font-sans font-medium rounded-xl transition-all duration-200 inline-flex items-center justify-center gap-2';

    const variantClasses = {
      primary:
        'bg-primary text-white hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg',
      secondary:
        'bg-accent text-primary hover:bg-accent-dark disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg',
      ghost:
        'bg-transparent text-white hover:bg-background-elevated border border-background-elevated',
    };

    const sizeClasses = {
      sm: 'px-4 py-2 text-sm',
      md: 'px-6 py-3 text-base',
      lg: 'px-8 py-4 text-lg',
    };

    return (
      <button
        ref={ref}
        className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
        disabled={disabled}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
