module.exports = {
  apps: [
    {
      name: 'tradinglog',
      script: 'npx',
      args: 'wrangler pages dev dist --d1=tradinglog-production --local --ip 0.0.0.0 --port 3000',
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork',
      // 재발 방지: 죽어도 자동 재기동
      autorestart: true,
      max_restarts: 50,
      min_uptime: '10s',
      restart_delay: 2000,
      kill_timeout: 5000
    }
  ]
}
