import { describe, it, expect } from 'vitest';
import { buildDeliveryReceipt } from '../../src/protocol/delivery-receipt.js';

describe('buildDeliveryReceipt', () => {
  const baseParams = {
    messageId: 'abc-123',
    sourceAddr: 'MyBank',
    sourceAddrTon: 0x05,
    sourceAddrNpi: 0x00,
    destinationAddr: '+14155551234',
    destAddrTon: 0x01,
    destAddrNpi: 0x01,
    submitTime: new Date('2026-02-12T14:30:00Z'),
    doneTime: new Date('2026-02-12T14:30:01Z'),
  };

  it('builds a delivered receipt', () => {
    const receipt = buildDeliveryReceipt({
      ...baseParams,
      status: 'delivered',
      errorCode: 0,
    });

    expect(receipt.esm_class).toBe(0x04); // MC_DELIVERY_RECEIPT
    expect(receipt.message_state).toBe(2); // DELIVERED
    expect(receipt.receipted_message_id).toBe('abc-123');
    // Source and dest are swapped in DLRs
    expect(receipt.source_addr).toBe('+14155551234');
    expect(receipt.destination_addr).toBe('MyBank');
    expect(receipt.short_message).toContain('stat:DELIVRD');
    expect(receipt.short_message).toContain('id:abc-123');
    expect(receipt.short_message).toContain('dlvrd:001');
  });

  it('builds a failed receipt', () => {
    const receipt = buildDeliveryReceipt({
      ...baseParams,
      status: 'failed',
      errorCode: 150,
    });

    expect(receipt.message_state).toBe(5); // UNDELIVERABLE
    expect(receipt.short_message).toContain('stat:UNDELIV');
    expect(receipt.short_message).toContain('dlvrd:000');
    expect(receipt.short_message).toContain('err:150');
  });

  it('formats dates correctly', () => {
    const receipt = buildDeliveryReceipt({
      ...baseParams,
      status: 'delivered',
      errorCode: 0,
    });

    // Date: 2026-02-12 14:30 → "2602121430"
    expect(receipt.short_message).toContain('submit date:2602121430');
    expect(receipt.short_message).toContain('done date:2602121430');
  });
});
