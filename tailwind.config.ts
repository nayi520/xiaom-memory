import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#4F46E5',
          dark: '#4338CA',
          light: '#EEF2FF',
        },
      },
    },
  },
  plugins: [],
};

export default config;
