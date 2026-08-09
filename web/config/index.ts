import { Development } from './development';
import { Local } from './local';
import { LocalApp } from './localapp';
import { Production } from './production';
import { Staging } from './staging';
import { Environment } from './types';

import type { Config as ConfigType } from './types';

const ENVIRONMENTS: Record<string, Environment> = {
  'pokedextracker.com': Environment.Production,
  'staging.pokedextracker.com': Environment.Staging,
};

// LOCAL_APP builds (the static/offline app and the Android APK) have no
// backend at all, so they short-circuit the hostname-based selection.
const environment = process.env.LOCAL_APP ?
  Environment.LocalApp :
  ENVIRONMENTS[window.location.hostname] || process.env.NODE_ENV || Environment.Development;

const Configs: Record<Environment, ConfigType> = {
  [Environment.Development]: Development,
  [Environment.Local]: Local,
  [Environment.LocalApp]: LocalApp,
  [Environment.Production]: Production,
  [Environment.Staging]: Staging,
};

export const Config = Configs[environment] as ConfigType;
