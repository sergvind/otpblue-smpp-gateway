import fs from 'node:fs';
import dotenv from 'dotenv';
import { ConfigSchema, type AppConfig } from './schema.js';

dotenv.config();

export function loadConfig(): AppConfig {
  const clientConfigPath = process.env.CLIENT_CONFIG_PATH || 'config/clients.json';

  let clients: unknown[];
  try {
    const raw = fs.readFileSync(clientConfigPath, 'utf-8');
    const parsed = JSON.parse(raw);
    clients = parsed.clients ?? parsed;
  } catch (err) {
    throw new Error(`Failed to load client config from ${clientConfigPath}: ${err}`);
  }

  const rawConfig = {
    smpp: {
      port: int(process.env.SMPP_PORT, 2775),
      tlsPort: int(process.env.SMPP_TLS_PORT, 2776),
      tlsKeyPath: process.env.SMPP_TLS_KEY_PATH,
      tlsCertPath: process.env.SMPP_TLS_CERT_PATH,
      enquireLinkTimeoutS: int(process.env.ENQUIRE_LINK_TIMEOUT_S, 90),
      shutdownGracePeriodS: int(process.env.SHUTDOWN_GRACE_PERIOD_S, 5),
    },
    otpblue: {
      apiUrl: process.env.OTPBLUE_API_URL || 'https://api.otpblue.com/imsg/api/v1.1/otp/send/',
      timeoutMs: int(process.env.OTPBLUE_API_TIMEOUT_MS, 15000),
    },
    health: {
      port: int(process.env.HEALTH_PORT, 8080),
    },
    logLevel: process.env.LOG_LEVEL || 'info',
    clients,
  };

  return ConfigSchema.parse(rawConfig);
}

function int(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = parseInt(value, 10);
  return isNaN(n) ? fallback : n;
}
