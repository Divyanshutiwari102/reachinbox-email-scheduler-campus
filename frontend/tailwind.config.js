/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        emerald: {
          50: '#f0fdf4',
          600: '#059669',
        },
        amber: {
          50: '#fffbeb',
          700: '#a16207',
        },
      },
    },
  },
  plugins: [],
}