import { randomUUID } from 'node:crypto';

/** Generate a unique message ID for SMPP responses. */
export function generateMessageId(): string {
  return randomUUID();
}
