const DEFAULT_PATTERNS: RegExp[] = [
  // Keyword followed by digits: "code: 482910", "Your OTP is 123456", "PIN: 9821"
  /(?:code|pin|otp|token|password|passcode|verify|verification)[:\s\-is]+(\d[\d\-\s]{2,9}\d)/i,
  // Standalone 4-10 digit number (most common OTP format)
  /\b(\d{4,10})\b/,
];

export interface ParsedMessage {
  code: string;
  sender: string;
  language?: string;
}

export interface ParserOptions {
  codePatterns?: string[];
}

/**
 * Extract OTP code from an SMPP short_message field.
 * The message can be a full text like "Your verification code is 482910"
 * or just the code itself "482910".
 */
export function extractOtpCode(
  shortMessage: string | Buffer | { message: string; udh?: Buffer },
  dataCoding: number,
  options?: ParserOptions,
): string | null {
  const text = decodeMessage(shortMessage, dataCoding).trim();
  if (!text) return null;

  // If the entire message is just digits (4-10), use it directly
  if (/^\d{4,10}$/.test(text)) {
    return text;
  }

  // If the entire message is digits with hyphens/spaces (e.g., "482-910")
  const stripped = text.replace(/[-\s]/g, '');
  if (/^\d{4,10}$/.test(stripped) && text.length <= 15) {
    return stripped;
  }

  // Try custom patterns first, then defaults
  const patterns = buildPatterns(options?.codePatterns);
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].replace(/[-\s]/g, '');
    }
  }

  return null;
}

/**
 * Resolve the sender name from SMPP source_addr and TON.
 * TON=5 (Alphanumeric) means source_addr is a brand name.
 * Otherwise fall back to defaultSender.
 */
export function resolveSender(
  sourceAddr: string,
  sourceAddrTon: number,
  defaultSender?: string,
): string {
  // TON 0x05 = Alphanumeric → brand name like "MyBank"
  if (sourceAddrTon === 0x05 && sourceAddr) {
    return sourceAddr.slice(0, 16);
  }
  // For phone numbers/short codes, use the configured default
  if (defaultSender) {
    return defaultSender;
  }
  // Last resort: use whatever source_addr we have
  return sourceAddr || 'OTP';
}

function decodeMessage(
  msg: string | Buffer | { message: string; udh?: Buffer },
  dataCoding: number,
): string {
  if (typeof msg === 'string') return msg;

  if (Buffer.isBuffer(msg)) {
    // UCS-2 (UTF-16 BE)
    if (dataCoding === 0x08) return msg.toString('utf16le');
    // Default / ASCII / Latin-1
    return msg.toString('utf-8');
  }

  if (msg && typeof msg === 'object' && 'message' in msg) {
    const inner = (msg as { message: string | Buffer }).message;
    if (typeof inner === 'string') return inner;
    if (Buffer.isBuffer(inner)) {
      if (dataCoding === 0x08) return inner.toString('utf16le');
      return inner.toString('utf-8');
    }
  }

  return String(msg);
}

function buildPatterns(customPatterns?: string[]): RegExp[] {
  if (!customPatterns || customPatterns.length === 0) {
    return DEFAULT_PATTERNS;
  }
  const custom: RegExp[] = [];
  for (const p of customPatterns) {
    try {
      custom.push(new RegExp(p, 'i'));
    } catch {
      // Skip invalid regex patterns — logged at config load time
    }
  }
  return [...custom, ...DEFAULT_PATTERNS];
}
