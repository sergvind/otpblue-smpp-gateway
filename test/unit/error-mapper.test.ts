import { describe, it, expect } from 'vitest';
import {
  mapOtpBlueErrorToSmppStatus,
  mapStatusToReceiptStat,
  mapStatusToMessageState,
} from '../../src/protocol/error-mapper.js';

describe('mapOtpBlueErrorToSmppStatus', () => {
  it('maps 150 (no iMessage) to ESME_RSUBMITFAIL', () => {
    expect(mapOtpBlueErrorToSmppStatus(150)).toBe(0x00000045);
  });

  it('maps 720 (no capacity) to ESME_RTHROTTLED', () => {
    expect(mapOtpBlueErrorToSmppStatus(720)).toBe(0x00000058);
  });

  it('maps 1800 (invalid phone) to ESME_RINVDSTADR', () => {
    expect(mapOtpBlueErrorToSmppStatus(1800)).toBe(0x0000000B);
  });

  it('maps 1600 (invalid recipient) to ESME_RINVDSTADR', () => {
    expect(mapOtpBlueErrorToSmppStatus(1600)).toBe(0x0000000B);
  });

  it('maps 100 (internal error) to ESME_RSYSERR', () => {
    expect(mapOtpBlueErrorToSmppStatus(100)).toBe(0x00000008);
  });

  it('maps 1250 (invalid API key) to ESME_RINVSYSID', () => {
    expect(mapOtpBlueErrorToSmppStatus(1250)).toBe(0x0000000F);
  });

  it('maps unknown codes to ESME_RSYSERR', () => {
    expect(mapOtpBlueErrorToSmppStatus(9999)).toBe(0x00000008);
  });
});

describe('mapStatusToReceiptStat', () => {
  it('maps delivered to DELIVRD', () => {
    expect(mapStatusToReceiptStat('delivered')).toBe('DELIVRD');
  });

  it('maps failed to UNDELIV', () => {
    expect(mapStatusToReceiptStat('failed')).toBe('UNDELIV');
  });
});

describe('mapStatusToMessageState', () => {
  it('maps delivered to 2 (DELIVERED)', () => {
    expect(mapStatusToMessageState('delivered')).toBe(2);
  });

  it('maps failed to 5 (UNDELIVERABLE)', () => {
    expect(mapStatusToMessageState('failed')).toBe(5);
  });
});
