module.exports = {
  apps: [{
    name: 'nestiq',
    script: './backend/server.js',
    instances: 'max',           // One worker per CPU core
    exec_mode: 'cluster',
    watch: false,
    max_memory_restart: '500M', // Restart worker if it leaks past 500MB
    kill_timeout: 10000,        // Wait 10s for graceful shutdown before force-kill
    listen_timeout: 8000,       // Wait 8s for worker to be ready before marking failed
    env: {
      NODE_ENV: 'development',
      PORT: 5000,
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 5000,
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }]
};
