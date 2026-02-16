import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import nock from 'nock';
import smpp from 'smpp';
import type { Session, PDU } from 'smpp';
import { CredentialStore } from '../../src/auth/credential-store.js';
import { OtpBlueClient } from '../../src/api/otpblue-client.js';
import { createSessionHandler } from '../../src/smpp/session-handler.js';
import { BindRateLimiter } from '../../src/auth/bind-rate-limiter.js';
import { TokenBucketRateLimiter } from '../../src/utils/rate-limiter.js';
import type { AppConfig, AuthApiConfig, ClientConfig } from '../../src/config/schema.js';

const TEST_PORT = 12775;
const API_URL = 'https://api.otpblue.com';
const API_PATH = '/imsg/api/v1.1/otp/send/';

const AUTH_API_BASE = 'https://auth.test.com';
const AUTH_API_KEY = 'test-auth-key';
const AUTH_PATH = '/api/v1/smpp/auth/';

const authApiConfig: AuthApiConfig = {
  url: AUTH_API_BASE,
  apiKey: AUTH_API_KEY,
  cacheTtlMs: 300_000,
};

const testClient: ClientConfig = {
  systemId: 'test_client',
  password: 'test_pass',
  apiKey: 'test-api-key-123',
  defaultSender: 'TestApp',
  defaultLanguage: 'en',
  maxTps: 100,
  enabled: true,
  failureMode: 'immediate',
};

const testConfig: AppConfig = {
  smpp: {
    port: TEST_PORT,
    tlsPort: TEST_PORT + 1,
    enablePlaintext: true,
    enquireLinkTimeoutS: 30,
    shutdownGracePeriodS: 1,
    maxConnections: 1000,
    preBindTimeoutS: 30,
    maxSessionDurationS: 86400,
  },
  otpblue: {
    apiUrl: API_URL + API_PATH,
    timeoutMs: 5000,
  },
  health: { port: 18080, bindAddress: '127.0.0.1' },
  logLevel: 'error',
  authApi: authApiConfig,
};

let server: ReturnType<typeof smpp.createServer>;
let credentialStore: CredentialStore;
let otpBlueClient: OtpBlueClient;
let bindRateLimiter: BindRateLimiter;
let clientRateLimiters: Map<string, TokenBucketRateLimiter>;

beforeAll(() => {
  credentialStore = new CredentialStore(authApiConfig);
  otpBlueClient = new OtpBlueClient(testConfig.otpblue.apiUrl, testConfig.otpblue.timeoutMs);
  bindRateLimiter = new BindRateLimiter();
  clientRateLimiters = new Map();

  server = smpp.createServer((session: Session) => {
    const preBindTimer = setTimeout(() => {
      try { session.destroy(); } catch { /* ignore */ }
    }, testConfig.smpp.preBindTimeoutS * 1000);

    createSessionHandler(
      session,
      credentialStore,
      otpBlueClient,
      testConfig,
      bindRateLimiter,
      clientRateLimiters,
      preBindTimer,
    );
  });

  return new Promise<void>((resolve) => {
    server.listen(TEST_PORT, () => resolve());
  });
});

afterAll(() => {
  // Force-close all sessions so server.close() resolves
  for (const session of server.sessions || []) {
    try { session.destroy(); } catch { /* ignore */ }
  }
  return new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

beforeEach(() => {
  nock.cleanAll();

  // Auth API mocks for credential store
  nock(AUTH_API_BASE)
    .get(AUTH_PATH)
    .query({ system_id: 'test_client' })
    .reply(200, testClient);
  nock(AUTH_API_BASE)
    .get(AUTH_PATH)
    .query({ system_id: 'unknown' })
    .reply(404, { error: 'Not found' });
});

function connectClient(): Promise<Session> {
  return new Promise((resolve) => {
    const session = smpp.connect({ host: '127.0.0.1', port: TEST_PORT }, () => {
      resolve(session);
    });
  });
}

function bindTransceiver(session: Session): Promise<PDU> {
  return new Promise((resolve) => {
    session.bind_transceiver(
      { system_id: 'test_client', password: 'test_pass' },
      (pdu: PDU) => resolve(pdu),
    );
  });
}

describe('SMPP Integration Flow', () => {
  it('binds successfully with valid credentials', async () => {
    const session = await connectClient();
    const resp = await bindTransceiver(session);
    expect(resp.command_status).toBe(0); // ESME_ROK
    session.destroy();
  });

  it('rejects bind with wrong password', async () => {
    const session = await connectClient();
    const resp = await new Promise<PDU>((resolve) => {
      session.bind_transceiver(
        { system_id: 'test_client', password: 'wrong' },
        (pdu: PDU) => resolve(pdu),
      );
    });
    expect(resp.command_status).toBe(0x0000000E); // ESME_RINVPASWD
    session.destroy();
  });

  it('rejects bind with unknown system_id', async () => {
    const session = await connectClient();
    const resp = await new Promise<PDU>((resolve) => {
      session.bind_transceiver(
        { system_id: 'unknown', password: 'test_pass' },
        (pdu: PDU) => resolve(pdu),
      );
    });
    expect(resp.command_status).toBe(0x0000000E); // ESME_RINVPASWD
    session.destroy();
  });

  it('delivers OTP successfully (full flow: bind → submit → response + DLR)', async () => {
    // Mock OTP Blue API
    const apiScope = nock(API_URL)
      .post(API_PATH, {
        contact: '+14155551234',
        code: '482910',
        sender: 'MyBank',
        language: 'en',
      })
      .reply(200, {
        success: true,
        message: 'Request has been accepted and sent',
        message_id: 'test-msg-id-123',
        recipient: '+14155551234',
        status: 'delivered',
      });

    const session = await connectClient();
    await bindTransceiver(session);

    // Listen for delivery receipt
    const dlrPromise = new Promise<PDU>((resolve) => {
      session.on('deliver_sm', (pdu: PDU) => {
        session.send(pdu.response());
        resolve(pdu);
      });
    });

    // Send submit_sm
    const submitResp = await new Promise<PDU>((resolve) => {
      session.submit_sm(
        {
          source_addr_ton: 0x05,
          source_addr: 'MyBank',
          dest_addr_ton: 0x01,
          dest_addr_npi: 0x01,
          destination_addr: '14155551234',
          short_message: 'Your verification code is 482910',
          data_coding: 0x00,
          registered_delivery: 0x01,
        },
        (pdu: PDU) => resolve(pdu),
      );
    });

    // Verify submit_sm_resp
    expect(submitResp.command_status).toBe(0); // ESME_ROK
    expect(submitResp.message_id).toBe('test-msg-id-123');

    // Verify delivery receipt
    const dlr = await dlrPromise;
    expect(dlr.esm_class).toBe(0x04); // MC_DELIVERY_RECEIPT
    // node-smpp decodes short_message as {message, udh} object
    const dlrText = typeof dlr.short_message === 'object' && dlr.short_message !== null && 'message' in (dlr.short_message as object)
      ? String((dlr.short_message as { message: unknown }).message)
      : String(dlr.short_message);
    expect(dlrText).toContain('stat:DELIVRD');
    expect(dlrText).toContain('id:test-msg-id-123');
    expect(dlr.receipted_message_id).toBe('test-msg-id-123');

    apiScope.done();
    session.destroy();
  });

  it('returns SMPP error for no-iMessage (error 150) in immediate mode', async () => {
    nock(API_URL)
      .post(API_PATH)
      .reply(400, {
        success: false,
        code: 150,
        contact: '+14155551234',
        message: 'Recipient does not support delivery through this channel',
        status: 'failed',
      });

    const session = await connectClient();
    await bindTransceiver(session);

    const submitResp = await new Promise<PDU>((resolve) => {
      session.submit_sm(
        {
          source_addr_ton: 0x05,
          source_addr: 'MyBank',
          dest_addr_ton: 0x01,
          destination_addr: '14155551234',
          short_message: 'Your code is 123456',
          registered_delivery: 0x01,
        },
        (pdu: PDU) => resolve(pdu),
      );
    });

    // Should return ESME_RSUBMITFAIL (0x45) for no-iMessage
    expect(submitResp.command_status).toBe(0x00000045);
    session.destroy();
  });

  it('handles enquire_link keepalive', async () => {
    const session = await connectClient();
    await bindTransceiver(session);

    const resp = await new Promise<PDU>((resolve) => {
      session.enquire_link({}, (pdu: PDU) => resolve(pdu));
    });

    expect(resp.command_status).toBe(0); // ESME_ROK
    session.destroy();
  });

  it('rejects submit_sm before bind', async () => {
    const session = await connectClient();

    const resp = await new Promise<PDU>((resolve) => {
      session.submit_sm(
        {
          source_addr: 'Test',
          destination_addr: '14155551234',
          short_message: '123456',
        },
        (pdu: PDU) => resolve(pdu),
      );
    });

    expect(resp.command_status).toBe(0x00000004); // ESME_RINVBNDSTS
    session.destroy();
  });

  it('returns ESME_RINVMSGLEN when OTP code cannot be extracted', async () => {
    const session = await connectClient();
    await bindTransceiver(session);

    const resp = await new Promise<PDU>((resolve) => {
      session.submit_sm(
        {
          source_addr: 'Test',
          dest_addr_ton: 0x01,
          destination_addr: '14155551234',
          short_message: 'Hello World no digits here',
          registered_delivery: 0x01,
        },
        (pdu: PDU) => resolve(pdu),
      );
    });

    expect(resp.command_status).toBe(0x00000001); // ESME_RINVMSGLEN
    session.destroy();
  });

  it('returns ESME_RTHROTTLED when rate limit exceeded', async () => {
    // Use a fresh rate limiter map so this test isn't affected by others
    clientRateLimiters.clear();

    const session = await connectClient();
    await bindTransceiver(session);

    // Create many concurrent API mocks
    nock(API_URL).post(API_PATH).times(200).reply(200, {
      success: true,
      message_id: 'x',
      recipient: '+14155551234',
      status: 'delivered',
    });

    // Fire more requests than maxTps (100)
    const results: PDU[] = [];
    const promises: Promise<void>[] = [];

    for (let i = 0; i < 120; i++) {
      promises.push(
        new Promise<void>((resolve) => {
          session.submit_sm(
            {
              source_addr_ton: 0x05,
              source_addr: 'Test',
              dest_addr_ton: 0x01,
              destination_addr: '14155551234',
              short_message: String(100000 + i),
            },
            (pdu: PDU) => {
              results.push(pdu);
              resolve();
            },
          );
        }),
      );
    }

    await Promise.all(promises);

    const throttled = results.filter(r => r.command_status === 0x00000058);
    expect(throttled.length).toBeGreaterThan(0);
    session.destroy();
  });

  it('does not send DLR when registered_delivery is 0', async () => {
    nock(API_URL)
      .post(API_PATH)
      .reply(200, {
        success: true,
        message_id: 'no-dlr-test',
        recipient: '+14155551234',
        status: 'delivered',
      });

    const session = await connectClient();
    await bindTransceiver(session);

    let dlrReceived = false;
    session.on('deliver_sm', () => {
      dlrReceived = true;
    });

    await new Promise<PDU>((resolve) => {
      session.submit_sm(
        {
          source_addr_ton: 0x05,
          source_addr: 'Test',
          dest_addr_ton: 0x01,
          destination_addr: '14155551234',
          short_message: '482910',
          registered_delivery: 0x00, // No receipt requested
        },
        (pdu: PDU) => resolve(pdu),
      );
    });

    // Wait a bit to confirm no DLR arrives
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(dlrReceived).toBe(false);
    session.destroy();
  });
});
