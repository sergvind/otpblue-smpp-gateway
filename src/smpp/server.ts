import fs from 'node:fs';
import smpp from 'smpp';
import type { SmppServer, Session } from 'smpp';
import type { AppConfig } from '../config/schema.js';
import { logger } from '../monitoring/logger.js';
import { createSessionHandler } from './session-handler.js';
import { CredentialStore } from '../auth/credential-store.js';
import { OtpBlueClient } from '../api/otpblue-client.js';
import { BindRateLimiter } from '../auth/bind-rate-limiter.js';
import { TokenBucketRateLimiter } from '../utils/rate-limiter.js';

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
  const bindRateLimiter = new BindRateLimiter();
  const clientRateLimiters = new Map<string, TokenBucketRateLimiter>();

  const onSession = (session: Session) => {
    // Connection limit
    if (activeSessions.size >= config.smpp.maxConnections) {
      logger.warn(
        { current: activeSessions.size, max: config.smpp.maxConnections },
        'Connection limit reached, rejecting new connection',
      );
      session.destroy();
      return;
    }

    activeSessions.add(session);
    session.on('close', () => activeSessions.delete(session));

    // Pre-bind timeout: destroy sessions that don't authenticate in time
    const preBindTimer = setTimeout(() => {
      if ((session as unknown as { writable: boolean }).writable) {
        logger.warn({ remote: session.remoteAddress }, 'Pre-bind timeout, destroying session');
        session.destroy();
      }
    }, config.smpp.preBindTimeoutS * 1000);

    createSessionHandler(
      session,
      credentialStore,
      otpBlueClient,
      config,
      bindRateLimiter,
      clientRateLimiters,
      preBindTimer,
    );
  };

  // Plaintext SMPP server
  let plain: SmppServer | undefined;
  if (config.smpp.enablePlaintext) {
    if (config.smpp.tlsKeyPath && config.smpp.tlsCertPath) {
      logger.warn('Plaintext SMPP is enabled alongside TLS. Consider setting SMPP_ENABLE_PLAINTEXT=false in production');
    }
    plain = smpp.createServer(onSession);
    plain.listen(config.smpp.port, () => {
      logger.info({ port: config.smpp.port }, 'SMPP server listening (plaintext)');
    });
  }

  // TLS SMPP server (optional)
  let tls: SmppServer | undefined;
  if (config.smpp.tlsKeyPath && config.smpp.tlsCertPath) {
    tls = smpp.createServer(
      {
        key: fs.readFileSync(config.smpp.tlsKeyPath, 'utf-8'),
        cert: fs.readFileSync(config.smpp.tlsCertPath, 'utf-8'),
        minVersion: 'TLSv1.2',
      },
      onSession,
    );
    tls.listen(config.smpp.tlsPort, () => {
      logger.info({ port: config.smpp.tlsPort }, 'SMPP server listening (TLS)');
    });
  }

  if (!plain && !tls) {
    throw new Error('No SMPP server started. Enable plaintext (SMPP_ENABLE_PLAINTEXT=true) or configure TLS certificates.');
  }

  // Graceful shutdown: unbind all sessions, then close servers
  const shutdown = async () => {
    logger.info({ sessions: activeSessions.size }, 'Shutting down SMPP servers');

    for (const session of activeSessions) {
      try { session.unbind(); } catch { /* already closed */ }
    }

    await new Promise(resolve => setTimeout(resolve, config.smpp.shutdownGracePeriodS * 1000));

    for (const session of activeSessions) {
      try { session.destroy(); } catch { /* ignore */ }
    }

    return new Promise<void>((resolve) => {
      let pending = (plain ? 1 : 0) + (tls ? 1 : 0);
      if (pending === 0) { resolve(); return; }
      const done = () => { if (--pending <= 0) resolve(); };
      if (plain) plain.close(done);
      if (tls) tls.close(done);
    });
  };

  return { plain, tls, shutdown };
}
