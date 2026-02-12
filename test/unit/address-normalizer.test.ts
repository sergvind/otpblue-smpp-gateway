import { describe, it, expect } from 'vitest';
import { normalizeToE164, getCountryFromPhone, resolveLanguage } from '../../src/protocol/address-normalizer.js';

describe('normalizeToE164', () => {
  it('normalizes international number with +', () => {
    expect(normalizeToE164('+14155551234', 0x01, 0x01)).toBe('+14155551234');
  });

  it('adds + prefix for TON=1 (International)', () => {
    expect(normalizeToE164('14155551234', 0x01, 0x01)).toBe('+14155551234');
  });

  it('handles TON=0 (Unknown) with country code', () => {
    expect(normalizeToE164('14155551234', 0x00, 0x00)).toBe('+14155551234');
  });

  it('strips dashes and spaces', () => {
    expect(normalizeToE164('+1 415-555-1234', 0x01, 0x01)).toBe('+14155551234');
  });

  it('returns alphanumeric sender IDs as-is for TON=5', () => {
    expect(normalizeToE164('MyBank', 0x05, 0x00)).toBe('MyBank');
  });

  it('handles UK numbers', () => {
    expect(normalizeToE164('447911123456', 0x01, 0x01)).toBe('+447911123456');
  });

  it('handles German numbers', () => {
    expect(normalizeToE164('+4915112345678', 0x01, 0x01)).toBe('+4915112345678');
  });
});

describe('getCountryFromPhone', () => {
  it('detects US numbers', () => {
    expect(getCountryFromPhone('+14155551234')).toBe('US');
  });

  it('detects UK numbers', () => {
    expect(getCountryFromPhone('+442071234567')).toBe('GB');
  });

  it('detects French numbers', () => {
    expect(getCountryFromPhone('+33612345678')).toBe('FR');
  });

  it('returns null for invalid numbers', () => {
    expect(getCountryFromPhone('invalid')).toBeNull();
  });
});

describe('resolveLanguage', () => {
  it('uses default language when not en', () => {
    expect(resolveLanguage('fr', '+14155551234')).toBe('fr');
  });

  it('derives language from French phone number when default is en', () => {
    expect(resolveLanguage('en', '+33612345678')).toBe('fr');
  });

  it('derives language from German phone number', () => {
    expect(resolveLanguage('en', '+4915112345678')).toBe('de');
  });

  it('falls back to en for unknown countries', () => {
    expect(resolveLanguage('en', '+999123456789')).toBe('en');
  });

  it('uses en as ultimate fallback', () => {
    expect(resolveLanguage('', 'invalid')).toBe('en');
  });
});
