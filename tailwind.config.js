/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        ai: {
          surface: 'var(--ai-surface)',
          primary: 'var(--ai-text-primary)',
          secondary: 'var(--ai-text-secondary)',
          accent: 'var(--ai-accent)',
          border: 'var(--ai-border)'
        }
      }
    }
  },
  plugins: []
};
