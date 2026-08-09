import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.chriar.pokedextracker',
  appName: 'Pokédex Tracker',
  webDir: 'build',
  android: {
    // Android 15 enforces edge-to-edge, which draws the app under the status
    // bar; this pads the WebView back below it so the nav stays reachable.
    adjustMarginsForEdgeToEdge: 'auto',
  },
};

export default config;
