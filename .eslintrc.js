module.exports = {
  env: {
    node: true,
    es2021: true,
    jest: true,  // For test globals like describe, it, expect
  },
  extends: [
    'airbnb-base',  // Popular strict rules for Node.js/Express
    'prettier'      // Turns off conflicting rules
  ],
  plugins: ['prettier'],
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'module',
  },
  rules: {
    'prettier/prettier': 'error',
    'no-console': 'warn',  // Allow console.log in development
    'class-methods-use-this': 'off',
    'no-param-reassign': 'off',
  },
};