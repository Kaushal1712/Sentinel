/**
 * Button — primary interactive element following the Sentinel design system.
 *
 * Variants:
 *   primary   — blue filled (default)
 *   secondary — subtle glass
 *   ghost     — transparent with hover
 *   danger    — red for destructive actions
 *
 * Sizes: sm | md (default) | lg
 */

import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { LoadingSpinner } from './LoadingSpinner';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: ReactNode;
  children: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: [
    'bg-accent-blue text-white',
    'hover:bg-blue-500 active:bg-blue-600',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    'shadow-glow-blue',
  ].join(' '),
  secondary: [
    'bg-white/5 border border-white/10 text-text-primary',
    'hover:bg-white/10 hover:border-white/20',
    'disabled:opacity-50 disabled:cursor-not-allowed',
  ].join(' '),
  ghost: [
    'text-text-secondary',
    'hover:text-text-primary hover:bg-white/5',
    'disabled:opacity-40 disabled:cursor-not-allowed',
  ].join(' '),
  danger: [
    'bg-accent-red/10 border border-accent-red/30 text-accent-red',
    'hover:bg-accent-red/20 hover:border-accent-red/50',
    'disabled:opacity-50 disabled:cursor-not-allowed',
  ].join(' '),
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-7 px-3 text-xs rounded-md gap-1.5',
  md: 'h-9 px-4 text-sm rounded-lg gap-2',
  lg: 'h-11 px-6 text-base rounded-lg gap-2',
};

export function Button({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leftIcon,
  children,
  className = '',
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || isLoading}
      className={[
        'inline-flex items-center justify-center font-medium',
        'transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/50',
        variantClasses[variant],
        sizeClasses[size],
        className,
      ].join(' ')}
    >
      {isLoading ? (
        <LoadingSpinner size="sm" />
      ) : leftIcon ? (
        <span className="shrink-0">{leftIcon}</span>
      ) : null}
      <span>{children}</span>
    </button>
  );
}
