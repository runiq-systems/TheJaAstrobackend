export default {
  env: {
    node: true,
    es2021: true,
  },
  extends: [
    'eslint:recommended',  // Basic bug-catching rules
    'prettier'             // Must be last – disables formatting conflicts
  ],
  plugins: ['prettier'],
  rules: {
    'prettier/prettier': 'error',  // Optional: treat Prettier issues as errors
    'no-console': 'warn',          // Example rule you might want
  },
};