import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.marystig.vidafoodcaisse',
  appName: 'Z-pekenio',
  webDir: '.output/public',
  server: {
    // Production alias for this Vercel project (vida-food-caisse.vercel.app is owned elsewhere)
    url: 'https://vida-food-caisse-livid.vercel.app/',
    allowNavigation: [
      'vida-food-caisse-livid.vercel.app',
      'vida-food-caisse.vercel.app',
      '*.vercel.app',
    ],
  }
};

export default config;
