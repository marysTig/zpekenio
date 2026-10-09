import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.marystig.vidafoodcaisse',
  appName: 'Z-pekenio',
  webDir: '.vercel/output/static',
  server: {
    url: 'https://zpekenio.vercel.app/',
    cleartext: true,
    allowNavigation: [
      'zpekenio.vercel.app',
      '*.vercel.app',
    ],
  }
};

export default config;
