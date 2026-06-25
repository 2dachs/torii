import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        irori: {
          bg: '#181513',
          surface: '#241f1a',
          surface2: '#2a2420',
          ink: '#efe6d6',
          muted: '#a99c8c',
          gold: '#c9a96e',
        },
      },
      fontFamily: {
        serif: ['Noto Serif JP', 'Hiragino Mincho ProN', 'Yu Mincho', 'serif'],
      },
    },
  },
  plugins: [],
};

export default config;
