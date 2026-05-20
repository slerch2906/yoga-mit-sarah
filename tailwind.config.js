/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        yoga: {
          bg:      '#cfcbca',
          text:    '#443c3c',
          card:    '#dedad9',
          card2:   '#e8e4e3',
          border:  'rgba(68,60,60,0.15)',
          border2: 'rgba(68,60,60,0.25)',
          green:   { bg: '#e8ede6', text: '#3a5a30' },
          amber:   { bg: '#f0ebe0', text: '#6b4f1a' },
          red:     { bg: '#f0e6e6', text: '#6b2a2a' },
          gray:    'rgba(68,60,60,0.07)',
        },
      },
      fontFamily: {
        sans: ['Mulish', 'sans-serif'],
      },
      borderRadius: {
        'yoga': '12px',
        'yoga-lg': '20px',
      },
    },
  },
  plugins: [],
}
