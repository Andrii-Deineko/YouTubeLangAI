/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx,html}', '../ui/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ai: {
          surface: 'var(--ytai-surface, var(--ai-surface))',
          primary: 'var(--ytai-text-primary, var(--ai-text-primary))',
          secondary: 'var(--ytai-text-secondary, var(--ai-text-secondary))',
          accent: 'var(--ytai-accent, var(--ai-accent))',
          border: 'var(--ytai-border, var(--ai-border))'
        }
      }
    }
  },
  plugins: []
};
