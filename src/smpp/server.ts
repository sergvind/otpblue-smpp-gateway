import fs from 'node:fs';
import smpp from 'smpp';
import type { SmppServer, Session } from 'smpp';
import type { AppConfig } from '../config/schema.js';
import { logger } from '../monitoring/logger.js';
import { createSessionHandler } from './session-handler.js';
import { CredentialStore } from '../auth/credential-store.js';
import { OtpBlueClient } from '../api/otpblue-client.js';

export interface SmppServers {
  plain?: SmppServer;
  tls?: SmppServer;
  shutdown: () => Promise<void>;
}

export function startSmppServers(
  config: AppConfig,
  credentialStore: CredentialStore,
  otpBlueClient: OtpBlueClient,
): SmppServers {
  const activeSessions = new Set<Session>();

  const onSession = (session: Session) => {
    activeSessions.add(session);
    session.on('close', () => activeSessions.delete(session));
    createSessionHandler(session, credentialStore, otpBlueClient, config);
  };

  // Plaintext SMPP server
  const plain = smpp.createServer(onSession);
  plain.listen(config.smpp.port, () => {
    logger.info({ port: config.smpp.port }, 'SMPP server listening (plaintext)');
  });

  // TLS SMPP server (optional)
  let tls: SmppServer | undefined;
  if (config.smpp.tlsKeyPath && config.smpp.tlsCertPath) {
    tls = smpp.createServer(
      {
        key: fs.readFileSync(config.smpp.tlsKeyPath, 'utf-8'),
        cert: fs.readFileSync(config.smpp.tlsCertPath, 'utf-8'),
      },
      onSession,
    );
    tls.listen(config.smpp.tlsPort, () => {
      logger.info({ port: config.smpp.tlsPort }, 'SMPP server listening (TLS)');
    });
  }

  // Graceful shutdown: unbind all sessions, then close servers
  const shutdown = async () => {
    logger.info({ sessions: activeSessions.size }, 'Shutting down SMPP servers');

    // Send unbind to all active sessions
    for (const session of activeSessions) {
      try {
        session.unbind();
      } catch {
        // Session may already be closed
      }
    }

    // Wait for grace period
    await new Promise(resolve => setTimeout(resolve, config.smpp.shutdownGracePeriodS * 1000));

    // Force close remaining sessions
    for (const session of activeSessions) {
      try {
        session.destroy();
      } catch {
        // Ignore
      }
    }

    // Close servers
    return new Promise<void>((resolve) => {
      let pending = tls ? 2 : 1;
      const done = () => { if (--pending <= 0) resolve(); };
      plain.close(done);
      if (tls) tls.close(done);
    });
  };

  return { plain, tls, shutdown };
}
