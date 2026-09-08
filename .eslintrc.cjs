module.exports = {
  root: true,
  extends: ['eslint:recommended'],
  env: {
    browser: true,
    node: true,
    es2022: true,
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  globals: {
    chrome: 'readonly',
  },
  ignorePatterns: ['node_modules/', 'dist/', 'coverage/', '.superpowers/'],
};
