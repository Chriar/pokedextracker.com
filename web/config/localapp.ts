import type { Config } from './types';

export const LocalApp: Config = {
  API_HOST: '',
  ENVIRONMENT: 'localapp',
  // Same public tokens as development; both integrations are disabled or
  // inert in the offline app, but their constructors want real-looking input.
  GA_ID: 'UA-45307701-5',
  LOCAL_MODE: true,
  ROLLBAR_TOKEN: '19ffd96c890b422287ce3a06a917678e',
  VERSION: process.env.VERSION || 'localapp',
};
