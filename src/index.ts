import { loadConfig } from './config/index.js';
import { CredentialStore } from './auth/credential-store.js';
import { OtpBlueClient } from './api/otpblue-client.js';
import { startSmppServers } from './smpp/server.js';
import { startHealthServer, setReady } from './monitoring/health.js';
import { logger } from './monitoring/logger.js';

async function main() {
  const config = loadConfig();
  logger.level = config.logLevel;
  logger.info({ clients: config.clients.length }, 'Configuration loaded');

  const credentialStore = new CredentialStore(config.clients);
  const otpBlueClient = new OtpBlueClient(config.otpblue.apiUrl, config.otpblue.timeoutMs);

  // Start health/metrics HTTP server
  const healthServer = startHealthServer(config.health.port, config.health.bindAddress);

  // Start SMPP servers (plaintext + optional TLS)
  const smppServers = startSmppServers(config, credentialStore, otpBlueClient);
  setReady(true);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Received shutdown signal');
    setReady(false);

    await smppServers.shutdown();
    healthServer.close();

    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
