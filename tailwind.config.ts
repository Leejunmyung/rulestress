import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './src/ui/**/*.{ts,tsx}'],
  theme: { extend: {} },
} satisfies Config;
