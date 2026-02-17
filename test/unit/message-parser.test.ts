import { describe, it, expect } from 'vitest';
import { extractOtpCode, resolveSender } from '../../src/protocol/message-parser.js';

describe('extractOtpCode', () => {
  it('extracts code from plain digits', () => {
    expect(extractOtpCode('482910', 0)).toBe('482910');
  });

  it('extracts code from digits with hyphens', () => {
    expect(extractOtpCode('482-910', 0)).toBe('482910');
  });

  it('extracts code from digits with spaces', () => {
    expect(extractOtpCode('482 910', 0)).toBe('482910');
  });

  it('extracts code from "Your verification code is 482910"', () => {
    expect(extractOtpCode('Your verification code is 482910', 0)).toBe('482910');
  });

  it('extracts code from "OTP: 123456"', () => {
    expect(extractOtpCode('OTP: 123456', 0)).toBe('123456');
  });

  it('extracts code from "Your PIN is 9821"', () => {
    expect(extractOtpCode('Your PIN is 9821', 0)).toBe('9821');
  });

  it('extracts code from "Use token 12345678 to login"', () => {
    expect(extractOtpCode('Use token 12345678 to login', 0)).toBe('12345678');
  });

  it('extracts code from "code: 482-910"', () => {
    expect(extractOtpCode('code: 482-910', 0)).toBe('482910');
  });

  it('extracts code from "Please use 482910 to verify your account"', () => {
    expect(extractOtpCode('Please use 482910 to verify your account', 0)).toBe('482910');
  });

  it('extracts 4-digit codes', () => {
    expect(extractOtpCode('1234', 0)).toBe('1234');
  });

  it('extracts 10-digit codes', () => {
    expect(extractOtpCode('1234567890', 0)).toBe('1234567890');
  });

  it('returns null for empty string', () => {
    expect(extractOtpCode('', 0)).toBeNull();
  });

  it('returns null for text with no digits', () => {
    expect(extractOtpCode('Hello World', 0)).toBeNull();
  });

  it('returns null for short digit sequences (< 4)', () => {
    expect(extractOtpCode('Use 12 to verify', 0)).toBeNull();
  });

  it('uses custom patterns when provided', () => {
    const options = { codePatterns: ['KEY-(\\d{6})'] };
    expect(extractOtpCode('Your KEY-482910 is ready', 0, options)).toBe('482910');
  });

  it('handles Buffer input', () => {
    const buf = Buffer.from('482910', 'utf-8');
    expect(extractOtpCode(buf, 0)).toBe('482910');
  });

  it('handles object with message field', () => {
    expect(extractOtpCode({ message: 'code: 482910' } as unknown as string, 0)).toBe('482910');
  });
});

describe('resolveSender', () => {
  it('uses source_addr for alphanumeric TON (0x05)', () => {
    expect(resolveSender('MyBank', 0x05)).toBe('MyBank');
  });

  it('truncates sender to 16 chars', () => {
    expect(resolveSender('VeryLongBrandNameHere', 0x05)).toBe('VeryLongBrandNam');
  });

  it('returns undefined for international TON (0x01)', () => {
    expect(resolveSender('+14155551234', 0x01)).toBeUndefined();
  });

  it('returns undefined for short code TON (0x03)', () => {
    expect(resolveSender('12345', 0x03)).toBeUndefined();
  });

  it('returns undefined when nothing available', () => {
    expect(resolveSender('', 0x01)).toBeUndefined();
  });
});
