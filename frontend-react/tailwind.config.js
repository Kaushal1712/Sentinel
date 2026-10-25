/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      // ── Sentinel colour palette ────────────────────────────────────────
      // Translated from the existing CSS custom-property design system so
      // the React app maintains visual continuity with the current frontend.
      colors: {
        // Background scale
        'bg-primary':   '#050816',
        'bg-secondary': '#0a0e27',
        'bg-tertiary':  '#111633',
        'bg-card':      'rgba(15,20,50,0.6)',

        // Accent colours
        'accent-blue':   '#3b82f6',
        'accent-green':  '#10b981',
        'accent-purple': '#8b5cf6',
        'accent-amber':  '#f59e0b',
        'accent-red':    '#ef4444',
        'accent-cyan':   '#06b6d4',

        // Risk scale
        'risk-critical': '#ef4444',
        'risk-high':     '#f97316',
        'risk-medium':   '#f59e0b',
        'risk-low':      '#10b981',

        // Text
        'text-primary':   '#e2e8f0',
        'text-secondary': '#94a3b8',
        'text-tertiary':  '#64748b',
      },

      // ── Typography ────────────────────────────────────────────────────
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },

      // ── Sidebar width token ───────────────────────────────────────────
      width: {
        'sidebar': '260px',
      },

      // ── Glassmorphism backdrop blur ───────────────────────────────────
      backdropBlur: {
        'glass': '16px',
      },

      // ── Box shadows ───────────────────────────────────────────────────
      boxShadow: {
        'glow-blue':   '0 0 20px rgba(59,130,246,0.15)',
        'glow-green':  '0 0 20px rgba(16,185,129,0.15)',
        'glow-purple': '0 0 20px rgba(139,92,246,0.15)',
        'card':        '0 4px 12px rgba(0,0,0,0.4)',
        'card-lg':     '0 8px 32px rgba(0,0,0,0.5)',
      },

      // ── Border radius ─────────────────────────────────────────────────
      borderRadius: {
        'sm':  '6px',
        'md':  '10px',
        'lg':  '16px',
        'xl':  '20px',
      },

      // ── Animations ────────────────────────────────────────────────────
      animation: {
        'fade-in':    'fadeIn 0.3s ease-out',
        'slide-up':   'slideUp 0.25s ease-out',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'spin-slow':  'spin 2s linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%':   { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 4px rgba(59,130,246,0.3)' },
          '50%':      { boxShadow: '0 0 16px rgba(59,130,246,0.6)' },
        },
      },
    },
  },
  plugins: [],
};
