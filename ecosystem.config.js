module.exports = {
  apps: [
    {
      name: "z-pekenio",
      script: ".output/server/index.mjs",
      env: {
        PORT: 8080,
        HOST: "0.0.0.0",
      },
    },
  ],
};
