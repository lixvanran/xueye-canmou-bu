/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        teacher: {
          red: '#D32F2F',
          dark: '#1A1A1A',
          gold: '#FFA000',
        },
      },
      fontFamily: {
        sans: ['PingFang SC', 'Microsoft YaHei', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
