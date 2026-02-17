import smpp from 'smpp';
import type { Session, PDU } from 'smpp';
import type { AppConfig, ClientConfig } from '../config/schema.js';
import { CredentialStore } from '../auth/credential-store.js';
import { BindRateLimiter } from '../auth/bind-rate-limiter.js';
import { OtpBlueClient } from '../api/otpblue-client.js';
import { extractOtpCode, resolveSender, decodeMessage } from '../protocol/message-parser.js';
import { normalizeToE164 } from '../protocol/address-normalizer.js';
import { mapOtpBlueErrorToSmppStatus } from '../protocol/error-mapper.js';
import { buildDeliveryReceipt } from '../protocol/delivery-receipt.js';
import { generateMessageId } from '../utils/id-generator.js';
import { TokenBucketRateLimiter } from '../utils/rate-limiter.js';
import { logger, maskPhone } from '../monitoring/logger.js';
import * as metrics from '../monitoring/metrics.js';

// Input size limits
const MAX_SHORT_MESSAGE_BYTES = 512;
const MAX_DESTINATION_ADDR_LEN = 21;

interface SessionState {
  clientConfig: ClientConfig | null;
  rateLimiter: TokenBucketRateLimiter | null;
  bound: boolean;
  bindMode: 'tx' | 'rx' | 'trx' | null;
  inactivityTimer: ReturnType<typeof setTimeout> | null;
  maxSessionTimer: ReturnType<typeof setTimeout> | null;
}

export function createSessionHandler(
  session: Session,
  credentialStore: CredentialStore,
  otpBlueClient: OtpBlueClient,
  config: AppConfig,
  bindRateLimiter: BindRateLimiter,
  clientRateLimiters: Map<string, TokenBucketRateLimiter>,
  preBindTimer: ReturnType<typeof setTimeout>,
): void {
  const state: SessionState = {
    clientConfig: null,
    rateLimiter: null,
    bound: false,
    bindMode: null,
    inactivityTimer: null,
    maxSessionTimer: null,
  };

  const sessionLog = logger.child({ remote: session.remoteAddress });

  // ── Inactivity timeout ──────────────────────────────────────────

  function resetInactivityTimer() {
    if (state.inactivityTimer) clearTimeout(state.inactivityTimer);
    state.inactivityTimer = setTimeout(() => {
      sessionLog.warn('Session timed out due to inactivity');
      try { session.unbind(); } catch { /* ignore */ }
      setTimeout(() => {
        try { session.destroy(); } catch { /* ignore */ }
      }, 5000);
    }, config.smpp.enquireLinkTimeoutS * 1000);
  }

  // ── Bind handlers ───────────────────────────────────────────────

  async function handleBind(pdu: PDU, mode: 'tx' | 'rx' | 'trx') {
    const systemId = pdu.system_id || '';
    const password = pdu.password || '';
    const remoteIp = session.remoteAddress || 'unknown';
    const bindLog = sessionLog.child({ systemId, bindMode: mode });

    // Check if IP is blocked due to repeated failures
    if (bindRateLimiter.isBlocked(remoteIp)) {
      bindLog.warn({ ip: remoteIp }, 'Bind rejected: IP temporarily blocked');
      session.send(pdu.response({ command_status: smpp.ESME_RBINDFAIL }));
      session.destroy();
      return;
    }

    const client = await credentialStore.verifyPassword(systemId, password);
    if (!client) {
      bindRateLimiter.recordFailure(remoteIp);
      bindLog.warn({ ip: remoteIp }, 'Bind failed: invalid credentials');
      metrics.smppConnectionsTotal.inc({ system_id: systemId, status: 'auth_failed' });
      session.send(pdu.response({ command_status: smpp.ESME_RINVPASWD }));
      session.destroy();
      return;
    }

    if (!credentialStore.isIpAllowed(client, remoteIp)) {
      bindLog.warn({ ip: remoteIp }, 'Bind failed: IP not allowed');
      metrics.smppConnectionsTotal.inc({ system_id: systemId, status: 'ip_denied' });
      session.send(pdu.response({ command_status: smpp.ESME_RBINDFAIL }));
      session.destroy();
      return;
    }

    // Successful bind
    clearTimeout(preBindTimer);
    bindRateLimiter.recordSuccess(remoteIp);

    // Use shared per-client rate limiter
    if (!clientRateLimiters.has(systemId)) {
      clientRateLimiters.set(systemId, new TokenBucketRateLimiter(client.maxTps));
    }

    state.clientConfig = client;
    state.rateLimiter = clientRateLimiters.get(systemId)!;
    state.bound = true;
    state.bindMode = mode;

    metrics.smppConnectionsTotal.inc({ system_id: systemId, status: 'success' });
    metrics.smppActiveConnections.inc({ system_id: systemId });
    bindLog.info('Client bound successfully');

    session.send(pdu.response({ command_status: smpp.ESME_ROK }));
    resetInactivityTimer();

    // Maximum session duration timer
    state.maxSessionTimer = setTimeout(() => {
      sessionLog.info('Maximum session duration reached, disconnecting');
      try { session.unbind(); } catch { /* ignore */ }
      setTimeout(() => {
        try { session.destroy(); } catch { /* ignore */ }
      }, 5000);
    }, config.smpp.maxSessionDurationS * 1000);
  }

  session.on('bind_transceiver', (pdu: PDU) => handleBind(pdu, 'trx'));
  session.on('bind_transmitter', (pdu: PDU) => handleBind(pdu, 'tx'));
  session.on('bind_receiver', (pdu: PDU) => handleBind(pdu, 'rx'));

  // ── submit_sm handler (core logic) ──────────────────────────────

  session.on('submit_sm', async (pdu: PDU) => {
    resetInactivityTimer();

    if (!state.bound || !state.clientConfig || !state.rateLimiter) {
      session.send(pdu.response({ command_status: smpp.ESME_RINVBNDSTS }));
      return;
    }

    // Receiver-only sessions cannot submit
    if (state.bindMode === 'rx') {
      session.send(pdu.response({ command_status: smpp.ESME_RINVBNDSTS }));
      return;
    }

    const client = state.clientConfig;
    const systemId = client.systemId;

    metrics.submitSmReceived.inc({ system_id: systemId });

    // 1. Input size validation
    const destAddr = pdu.destination_addr || '';
    if (destAddr.length > MAX_DESTINATION_ADDR_LEN) {
      session.send(pdu.response({ command_status: smpp.ESME_RINVDSTADR }));
      return;
    }

    const shortMessage = pdu.short_message || '';
    const msgByteLen = getMessageByteLength(shortMessage);
    if (msgByteLen > MAX_SHORT_MESSAGE_BYTES) {
      session.send(pdu.response({ command_status: smpp.ESME_RINVMSGLEN }));
      return;
    }

    // 2. Rate limiting (shared per client, not per session)
    if (!state.rateLimiter.tryConsume()) {
      metrics.submitSmThrottled.inc({ system_id: systemId });
      session.send(pdu.response({ command_status: smpp.ESME_RTHROTTLED }));
      return;
    }

    const submitTime = new Date();

    try {
      // 3. Normalize destination phone to E.164
      const phone = normalizeToE164(destAddr, pdu.dest_addr_ton || 0, pdu.dest_addr_npi || 0);

      if (!phone) {
        session.send(pdu.response({ command_status: smpp.ESME_RINVDSTADR }));
        return;
      }

      // 4. Get message content for API
      let code: string | undefined;
      let message: string | undefined;

      if (client.allowSendText) {
        // Send full message text to the API as "message" parameter
        const text = decodeMessage(shortMessage, pdu.data_coding || 0).trim();
        if (!text) {
          session.send(pdu.response({ command_status: smpp.ESME_RINVMSGLEN }));
          return;
        }
        message = text;
      } else {
        // Extract OTP code from message text
        const extracted = extractOtpCode(
          shortMessage,
          pdu.data_coding || 0,
          { codePatterns: client.codePatterns },
        );

        if (!extracted) {
          sessionLog.warn(
            { destination: maskPhone(phone) },
            'Could not extract OTP code from message',
          );
          session.send(pdu.response({ command_status: smpp.ESME_RINVMSGLEN }));
          return;
        }
        code = extracted;
      }

      // 5. Resolve sender from source_addr
      const sender = resolveSender(
        pdu.source_addr || '',
        pdu.source_addr_ton || 0,
      );

      // 6. Call OTP Blue API
      const apiStartMs = Date.now();
      const apiResponse = await otpBlueClient.sendOtp(
        { contact: phone, code, message, sender },
        client.apiKey,
      );
      const apiLatencyS = (Date.now() - apiStartMs) / 1000;

      const doneTime = new Date();

      // 8. Handle response
      if (apiResponse.success) {
        // ── Success path ──
        metrics.submitSmSuccess.inc({ system_id: systemId });
        metrics.otpblueApiLatency.observe({ system_id: systemId, status: 'success' }, apiLatencyS);

        session.send(pdu.response({
          command_status: smpp.ESME_ROK,
          message_id: apiResponse.message_id,
        }));

        if (shouldSendReceipt(pdu.registered_delivery || 0, 'delivered')) {
          const receipt = buildDeliveryReceipt({
            messageId: apiResponse.message_id,
            sourceAddr: pdu.source_addr || '',
            sourceAddrTon: pdu.source_addr_ton || 0,
            sourceAddrNpi: pdu.source_addr_npi || 0,
            destinationAddr: pdu.destination_addr || '',
            destAddrTon: pdu.dest_addr_ton || 0,
            destAddrNpi: pdu.dest_addr_npi || 0,
            status: 'delivered',
            errorCode: 0,
            submitTime,
            doneTime,
          });
          session.deliver_sm(receipt as Record<string, unknown>);
        }

        sessionLog.info({
          messageId: apiResponse.message_id,
          destination: maskPhone(phone),
          sender,
          latencyMs: Date.now() - submitTime.getTime(),
        }, 'OTP delivered via iMessage');

      } else {
        // ── Failure path ──
        const errorCode = apiResponse.code;
        metrics.submitSmFailed.inc({ system_id: systemId, error_code: String(errorCode) });
        metrics.otpblueApiLatency.observe({ system_id: systemId, status: 'failed' }, apiLatencyS);

        if (client.failureMode === 'receipt_only') {
          const internalId = generateMessageId();
          session.send(pdu.response({
            command_status: smpp.ESME_ROK,
            message_id: internalId,
          }));

          if (shouldSendReceipt(pdu.registered_delivery || 0, 'failed')) {
            const receipt = buildDeliveryReceipt({
              messageId: internalId,
              sourceAddr: pdu.source_addr || '',
              sourceAddrTon: pdu.source_addr_ton || 0,
              sourceAddrNpi: pdu.source_addr_npi || 0,
              destinationAddr: pdu.destination_addr || '',
              destAddrTon: pdu.dest_addr_ton || 0,
              destAddrNpi: pdu.dest_addr_npi || 0,
              status: 'failed',
              errorCode,
              submitTime,
              doneTime,
            });
            session.deliver_sm(receipt as Record<string, unknown>);
          }
        } else {
          const smppStatus = mapOtpBlueErrorToSmppStatus(errorCode);
          session.send(pdu.response({
            command_status: smppStatus,
            message_id: '',
          }));
        }

        sessionLog.info({
          destination: maskPhone(phone),
          errorCode,
          failureMode: client.failureMode,
        }, 'OTP delivery failed');
      }
    } catch (error) {
      sessionLog.error(
        { error: error instanceof Error ? error.message : String(error) },
        'API call error',
      );
      metrics.submitSmFailed.inc({ system_id: systemId, error_code: 'network' });
      session.send(pdu.response({ command_status: smpp.ESME_RSYSERR }));
    }
  });

  // ── enquire_link handler ────────────────────────────────────────

  session.on('enquire_link', (pdu: PDU) => {
    resetInactivityTimer();
    session.send(pdu.response());
  });

  // ── unbind handler ──────────────────────────────────────────────

  session.on('unbind', (pdu: PDU) => {
    sessionLog.info('Client requested unbind');
    session.send(pdu.response());
    cleanupSession();
    session.close();
  });

  // ── Error and close handlers ────────────────────────────────────

  session.on('error', (error: Error) => {
    sessionLog.error({ error: error.message }, 'Session error');
    cleanupSession();
  });

  session.on('close', () => {
    sessionLog.info('Session closed');
    cleanupSession();
  });

  // ── Cleanup ─────────────────────────────────────────────────────

  function cleanupSession() {
    clearTimeout(preBindTimer);
    if (state.inactivityTimer) {
      clearTimeout(state.inactivityTimer);
      state.inactivityTimer = null;
    }
    if (state.maxSessionTimer) {
      clearTimeout(state.maxSessionTimer);
      state.maxSessionTimer = null;
    }
    if (state.clientConfig && state.bound) {
      metrics.smppActiveConnections.dec({ system_id: state.clientConfig.systemId });
    }
    state.bound = false;
  }
}

/**
 * Check whether a delivery receipt should be sent based on
 * the registered_delivery flags and the outcome.
 */
function shouldSendReceipt(registeredDelivery: number, outcome: 'delivered' | 'failed'): boolean {
  const receiptBits = registeredDelivery & 0x03;
  if (receiptBits === 0x01) return true;                       // Receipt on success AND failure
  if (receiptBits === 0x02 && outcome === 'failed') return true;  // Receipt on failure only
  if (receiptBits === 0x03 && outcome === 'delivered') return true; // Receipt on success only (v5.0)
  return false;
}

function getMessageByteLength(msg: unknown): number {
  if (Buffer.isBuffer(msg)) return msg.length;
  if (typeof msg === 'string') return Buffer.byteLength(msg);
  if (msg && typeof msg === 'object' && 'message' in msg) {
    const inner = (msg as Record<string, unknown>).message;
    if (Buffer.isBuffer(inner)) return inner.length;
    if (typeof inner === 'string') return Buffer.byteLength(inner);
  }
  return Buffer.byteLength(String(msg));
}
