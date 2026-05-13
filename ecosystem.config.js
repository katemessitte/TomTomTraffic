module.exports = {
  apps: [
    {
      name: 'tomtom-app',
      script: 'index.js',
      autorestart: true,
      watch: false,
      max_restarts: 50,
      restart_delay: 5000    // wait 5s before restarting after crash
    },
    {
      name: 'tomtom-data',
      script: 'data-loader/data-loader.js',
      env: {
        INTERVAL_MINUTES: '60'
      },
      autorestart: true,
      watch: false,
      max_restarts: 50,
      restart_delay: 5000
    }
  ]
};
