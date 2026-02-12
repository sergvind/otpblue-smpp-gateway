import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

/** Mask phone number for logging: +1415555**** */
export function maskPhone(phone: string): string {
  if (phone.length <= 6) return phone;
  return phone.slice(0, -4) + '****';
}
