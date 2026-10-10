import type { CapacitorConfig } from '@capacitor/cli';

// Load .env file if dotenv is available (dev environment)
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { config } = require('dotenv') as typeof import('dotenv');
  config();
} catch {
  // dotenv not available — rely on environment variables being set externally
}

const appUrl = process.env.VITE_APP_URL ?? 'https://zpekenio.vercel.app';
const appHost = new URL(appUrl).hostname;

const config: CapacitorConfig = {
  appId: 'com.marystig.vidafoodcaisse',
  appName: 'Z-pekenio',
  webDir: '.vercel/output/static',
  server: {
    url: appUrl,
    cleartext: true,
    allowNavigation: [
      appHost,
      `*.${appHost.split('.').slice(-2).join('.')}`,
    ],
  },
};

export default config;
