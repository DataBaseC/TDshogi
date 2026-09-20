/**
 * eslint 扁平配置（PLAN §P2）——只保留最有价值的两条规则：
 *  - `no-undef`：**这正是「路由层漏 require 导致 4 条接口 500」那类事故的克星**
 *  - `no-unused-vars`：提示清理死代码（warn，不阻塞）
 *
 * 不引入风格类规则（缩进/引号等），避免制造大量无意义 diff。
 */
'use strict';

/** Node 端（CommonJS）通用全局 */
const NODE_GLOBALS = {
  require: 'readonly',
  module: 'writable',
  exports: 'writable',
  process: 'readonly',
  console: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  Buffer: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  clearImmediate: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  AbortController: 'readonly',
  fetch: 'readonly',
  structuredClone: 'readonly',
};

/** 浏览器端（IIFE，script 而非 module）通用全局 */
const BROWSER_GLOBALS = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  WebSocket: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  alert: 'readonly',
  confirm: 'readonly',
  prompt: 'readonly',
  Image: 'readonly',
  Audio: 'readonly',
  Event: 'readonly',
  CustomEvent: 'readonly',
  HTMLElement: 'readonly',
  MutationObserver: 'readonly',
  NodeFilter: 'readonly', // document.createTreeWalker 的过滤常量（i18n.js 用）
  // 本项目自己的全局：`i18n.js` 在每个页面都**先于**页面脚本加载（`<script>` 顺序保证），
  // 所以 `I18N` 与 `window`/`document` 同性质。日期格式必须按当前语言来
  // （`I18N.fmt` / `I18N.fmtDate`），各页直接调用，不加 `window.` 前缀。
  I18N: 'readonly',
  IntersectionObserver: 'readonly',
  ResizeObserver: 'readonly',
  URLSearchParams: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  AbortController: 'readonly',
  FormData: 'readonly',
  Blob: 'readonly',
  performance: 'readonly',
  getComputedStyle: 'readonly',
  matchMedia: 'readonly',
  structuredClone: 'readonly',
};

const BASE_RULES = {
  'no-undef': 'error',
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
  // 真正的 bug 信号，保留为 error
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-duplicate-case': 'error',
  'no-unreachable': 'error',
  'no-cond-assign': 'error',
  'no-constant-condition': 'warn',
  'no-sparse-arrays': 'warn',
  'valid-typeof': 'error',
  'no-empty': ['warn', { allowEmptyCatch: true }],
};

module.exports = [
  {
    ignores: ['node_modules/**', 'data/**', 'dist/**', 'generated-images/**'],
  },
  {
    // 服务端 + 脚本 + 测试
    files: ['server.js', 'src/**/*.js', 'scripts/**/*.js', 'tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...NODE_GLOBALS },
    },
    rules: BASE_RULES,
  },
  {
    // 浏览器端脚本（无构建步骤，全部是 IIFE）
    files: ['public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...BROWSER_GLOBALS },
    },
    rules: BASE_RULES,
  },
  {
    // 测试脚本里的全局注入（globalThis 挂载等）无需额外处理
    files: ['tests/**/*.js'],
    rules: { 'no-unused-vars': 'off' },
  },
];
