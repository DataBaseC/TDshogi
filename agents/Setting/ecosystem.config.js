module.exports = {
    apps: [{
      name: 'ceshi',
      script: 'server.js',
      instances: 1,          // 单进程服务，必须 1（别开 cluster）
      autorestart: true,
      env: {
        PORT: 8085,
        ADMIN_PASSWORD: 'ANDY',     // 不设则默认 Cplusplus123，务必改
        DATA_DIR: '/var/lib/tdshogi',
        TRUST_PROXY: '1',                // 走 Nginx 反代必开
        LOG_LEVEL: 'info',
        LOG_FORMAT: 'text',
        // ADMIN_ENTRY_KEY: '可选-隐藏后台入口',
        // ADMIN_SECRET: '可选-token 签名密钥',
      },
    }],
  };