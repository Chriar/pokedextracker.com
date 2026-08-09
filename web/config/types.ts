export enum Environment {
  Development = 'development',
  Local = 'local',
  LocalApp = 'localapp',
  Production = 'production',
  Staging = 'staging',
}

export interface Config {
  API_HOST: string;
  ENVIRONMENT: string;
  GA_ID: string;
  LOCAL_MODE?: boolean;
  ROLLBAR_TOKEN: string;
  VERSION: string;
}
