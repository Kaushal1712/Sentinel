/**
 * Card — glassmorphism container matching the Sentinel design system.
 *
 * Use `padding` prop to control inner spacing.
 * Use `className` for layout-specific overrides (e.g. col-span-2).
 */

import { type HTMLAttributes, type ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Apply inner padding (default true). */
  padding?: boolean;
}

export function Card({ children, padding = true, className = '', ...rest }: CardProps) {
  return (
    <div
      {...rest}
      className={[
        // Glass surface
        'rounded-lg border border-white/[0.08]',
        'bg-bg-card backdrop-blur-glass',
        'shadow-card',
        // Optional inner padding
        padding ? 'p-5' : '',
        className,
      ].join(' ')}
    >
      {children}
    </div>
  );
}
