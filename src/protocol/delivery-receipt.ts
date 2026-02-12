import { mapStatusToReceiptStat, mapStatusToMessageState } from './error-mapper.js';

export interface DeliveryReceiptParams {
  messageId: string;
  sourceAddr: string;
  sourceAddrTon: number;
  sourceAddrNpi: number;
  destinationAddr: string;
  destAddrTon: number;
  destAddrNpi: number;
  status: 'delivered' | 'failed';
  errorCode: number;
  submitTime: Date;
  doneTime: Date;
}

/**
 * Build a deliver_sm PDU options object for a delivery receipt.
 * In delivery receipts, source and destination are swapped (the receipt
 * comes "from" the destination back to the sender).
 */
export function buildDeliveryReceipt(params: DeliveryReceiptParams): Record<string, unknown> {
  const stat = mapStatusToReceiptStat(params.status);
  const dlvrd = params.status === 'delivered' ? '001' : '000';
  const err = String(params.errorCode).padStart(3, '0');
  const submitDate = formatSmppDate(params.submitTime);
  const doneDate = formatSmppDate(params.doneTime);

  const receiptText =
    `id:${params.messageId} ` +
    `sub:001 ` +
    `dlvrd:${dlvrd} ` +
    `submit date:${submitDate} ` +
    `done date:${doneDate} ` +
    `stat:${stat} ` +
    `err:${err} ` +
    `text:`;

  return {
    // In DLRs, source/dest are reversed relative to the original message
    source_addr: params.destinationAddr,
    source_addr_ton: params.destAddrTon,
    source_addr_npi: params.destAddrNpi,
    destination_addr: params.sourceAddr,
    dest_addr_ton: params.sourceAddrTon,
    dest_addr_npi: params.sourceAddrNpi,
    esm_class: 0x04, // MC_DELIVERY_RECEIPT
    data_coding: 0x00,
    short_message: receiptText,
    receipted_message_id: params.messageId,
    message_state: mapStatusToMessageState(params.status),
  };
}

function formatSmppDate(date: Date): string {
  const yy = date.getUTCFullYear().toString().slice(-2);
  const MM = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = date.getUTCDate().toString().padStart(2, '0');
  const hh = date.getUTCHours().toString().padStart(2, '0');
  const mm = date.getUTCMinutes().toString().padStart(2, '0');
  return `${yy}${MM}${dd}${hh}${mm}`;
}
