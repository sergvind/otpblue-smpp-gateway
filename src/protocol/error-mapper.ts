/**
 * Map OTP Blue API error codes to SMPP command_status values.
 * Used in submit_sm_resp to tell the aggregator the result.
 */
export function mapOtpBlueErrorToSmppStatus(otpBlueCode: number): number {
  const ESME_RSYSERR = 0x00000008;
  const ESME_RINVDSTADR = 0x0000000B;
  const ESME_RINVSYSID = 0x0000000F;
  const ESME_RTHROTTLED = 0x00000058;
  const ESME_RSUBMITFAIL = 0x00000045;
  const ESME_RINVMSGLEN = 0x00000001;
  const ESME_RINVSRCADR = 0x0000000A;

  const mapping: Record<number, number> = {
    // System/internal errors
    100: ESME_RSYSERR,     // Internal error
    110: ESME_RSYSERR,     // Apple service error

    // Delivery failures
    150: ESME_RSUBMITFAIL, // No iMessage (most frequent -- triggers failover)
    280: ESME_RSUBMITFAIL, // Opted out

    // Capacity
    720: ESME_RTHROTTLED,  // No capacity

    // Invalid destination
    1600: ESME_RINVDSTADR, // Invalid recipient
    1800: ESME_RINVDSTADR, // Invalid phone number
    1900: ESME_RINVDSTADR, // Not mobile
    1155: ESME_RINVDSTADR, // Unsupported region

    // Auth errors
    1110: ESME_RINVSYSID,  // Missed credentials
    1250: ESME_RINVSYSID,  // Invalid API key

    // Parameter errors
    1205: ESME_RINVMSGLEN, // Missing params
    1210: ESME_RINVMSGLEN, // Invalid OTP value
    1215: ESME_RINVMSGLEN, // Invalid code length
    1220: ESME_RINVSRCADR, // Invalid sender
    1225: ESME_RINVSRCADR, // Sender too long
    1230: ESME_RSYSERR,   // Invalid language
    1160: ESME_RSYSERR,   // Invalid template language
  };

  return mapping[otpBlueCode] ?? ESME_RSYSERR;
}

/** Map OTP Blue status to SMPP delivery receipt stat field. */
export function mapStatusToReceiptStat(status: 'delivered' | 'failed'): string {
  return status === 'delivered' ? 'DELIVRD' : 'UNDELIV';
}

/** Map OTP Blue status to SMPP message_state integer. */
export function mapStatusToMessageState(status: 'delivered' | 'failed'): number {
  return status === 'delivered' ? 2 : 5; // DELIVERED=2, UNDELIVERABLE=5
}
