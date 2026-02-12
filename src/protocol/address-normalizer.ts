import libphonenumber from 'google-libphonenumber';

const phoneUtil = libphonenumber.PhoneNumberUtil.getInstance();
const PNF = libphonenumber.PhoneNumberFormat;

/**
 * Normalize an SMPP destination address to E.164 format (+1234567890).
 * Handles different TON (Type of Number) values.
 */
export function normalizeToE164(
  address: string,
  ton: number,
  _npi: number,
): string {
  // TON 0x05 = Alphanumeric sender ID, not a phone number
  if (ton === 0x05) return address;

  // Clean the address
  let cleaned = address.replace(/[\s\-()]/g, '');

  // TON 0x01 = International: should have country code, may lack '+'
  if (ton === 0x01 && !cleaned.startsWith('+')) {
    cleaned = '+' + cleaned;
  }

  // Try to parse with '+' prefix
  if (cleaned.startsWith('+')) {
    try {
      const parsed = phoneUtil.parse(cleaned);
      if (phoneUtil.isValidNumber(parsed)) {
        return phoneUtil.format(parsed, PNF.E164);
      }
    } catch {
      // Fall through
    }
    return cleaned;
  }

  // For numbers without '+' (TON=Unknown or National): try as international
  try {
    const withPlus = '+' + cleaned;
    const parsed = phoneUtil.parse(withPlus);
    if (phoneUtil.isValidNumber(parsed)) {
      return phoneUtil.format(parsed, PNF.E164);
    }
  } catch {
    // Fall through
  }

  // Last resort: return with '+' prefix
  return '+' + cleaned;
}

/**
 * Derive ISO 3166-1 alpha-2 country code from an E.164 phone number.
 */
export function getCountryFromPhone(e164Phone: string): string | null {
  try {
    const parsed = phoneUtil.parse(e164Phone);
    const region = phoneUtil.getRegionCodeForNumber(parsed);
    return region || null;
  } catch {
    return null;
  }
}

/** Map country code to OTP Blue supported language code. */
const COUNTRY_TO_LANGUAGE: Record<string, string> = {
  US: 'en', GB: 'en', CA: 'en', AU: 'en', NZ: 'en', IE: 'en',
  FR: 'fr',
  DE: 'de', AT: 'de',
  ES: 'es', MX: 'es',
  IT: 'it',
  PT: 'pt', BR: 'pt',
  NL: 'nl', BE: 'nl',
  PL: 'pl',
  SE: 'sv',
  NO: 'no',
  DK: 'da',
  FI: 'fi',
  RO: 'ro', MD: 'ro',
  BG: 'bg',
  UA: 'uk',
  RU: 'ru', KZ: 'ru', BY: 'ru',
  TR: 'tr',
  JP: 'ja',
  KR: 'kr',
  CN: 'zh', HK: 'zh', TW: 'zh',
  ID: 'in',
  MY: 'ms',
  VN: 'vi',
  TH: 'en',
  IS: 'is',
};

/**
 * Resolve language for OTP Blue API.
 * Priority: client config > country detection > "en"
 */
export function resolveLanguage(
  defaultLanguage: string,
  destinationPhone: string,
): string {
  if (defaultLanguage && defaultLanguage !== 'en') return defaultLanguage;

  const country = getCountryFromPhone(destinationPhone);
  if (country && COUNTRY_TO_LANGUAGE[country]) {
    return COUNTRY_TO_LANGUAGE[country];
  }

  return defaultLanguage || 'en';
}
