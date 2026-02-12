declare module 'smpp' {
  import { EventEmitter } from 'events';
  import type { Server as NetServer } from 'net';
  import type { Server as TlsServer, TlsOptions } from 'tls';

  // ── PDU ──────────────────────────────────────────────────────────

  interface PDUFields {
    command_length?: number;
    command_id?: number;
    command?: string;
    command_status?: number;
    sequence_number?: number;

    // Bind fields
    system_id?: string;
    password?: string;
    system_type?: string;
    interface_version?: number;
    addr_ton?: number;
    addr_npi?: number;
    address_range?: string;

    // Submit/Deliver fields
    service_type?: string;
    source_addr_ton?: number;
    source_addr_npi?: number;
    source_addr?: string;
    dest_addr_ton?: number;
    dest_addr_npi?: number;
    destination_addr?: string;
    esm_class?: number;
    protocol_id?: number;
    priority_flag?: number;
    schedule_delivery_time?: string | Date;
    validity_period?: string | Date;
    registered_delivery?: number;
    replace_if_present_flag?: number;
    data_coding?: number;
    sm_default_msg_id?: number;
    short_message?: string | Buffer | { message: string; udh?: Buffer };

    // Response fields
    message_id?: string;

    // TLV fields
    receipted_message_id?: string;
    message_state?: number;
    message_payload?: Buffer;
    source_port?: number;
    dest_port?: number;
    sar_msg_ref_num?: number;
    sar_total_segments?: number;
    sar_segment_seqnum?: number;
    user_message_reference?: number;
    language_indicator?: number;
    additional_status_info_text?: string;

    // Allow additional fields
    [key: string]: unknown;
  }

  class PDU implements PDUFields {
    command_length: number;
    command_id: number;
    command: string;
    command_status: number;
    sequence_number: number;

    system_id?: string;
    password?: string;
    system_type?: string;
    interface_version?: number;
    addr_ton?: number;
    addr_npi?: number;
    address_range?: string;

    service_type?: string;
    source_addr_ton?: number;
    source_addr_npi?: number;
    source_addr?: string;
    dest_addr_ton?: number;
    dest_addr_npi?: number;
    destination_addr?: string;
    esm_class?: number;
    protocol_id?: number;
    priority_flag?: number;
    schedule_delivery_time?: string | Date;
    validity_period?: string | Date;
    registered_delivery?: number;
    replace_if_present_flag?: number;
    data_coding?: number;
    sm_default_msg_id?: number;
    short_message?: string | Buffer | { message: string; udh?: Buffer };

    message_id?: string;
    receipted_message_id?: string;
    message_state?: number;
    message_payload?: Buffer;

    [key: string]: unknown;

    constructor(command: string, options?: Partial<PDUFields>);

    isResponse(): boolean;
    response(options?: Partial<PDUFields>): PDU;
    toBuffer(): Buffer;
  }

  // ── Session ──────────────────────────────────────────────────────

  type PDUCallback = (pdu: PDU) => void;
  type SendCallback = (pdu: PDU) => void;
  type FailureCallback = (pdu: PDU, error: Error) => void;

  interface Session extends EventEmitter {
    readonly remoteAddress: string;
    readonly remotePort: number;
    readonly sequence: number;
    readonly paused: boolean;
    readonly closed: boolean;

    send(pdu: PDU, responseCallback?: PDUCallback, sendCallback?: SendCallback, failureCallback?: FailureCallback): boolean;
    pause(): void;
    resume(): void;
    close(callback?: () => void): void;
    destroy(callback?: () => void): void;
    connect(): void;

    // Shortcut methods for all commands
    bind_transceiver(options: Partial<PDUFields>, responseCallback?: PDUCallback, sendCallback?: SendCallback, failureCallback?: FailureCallback): void;
    bind_transmitter(options: Partial<PDUFields>, responseCallback?: PDUCallback, sendCallback?: SendCallback, failureCallback?: FailureCallback): void;
    bind_receiver(options: Partial<PDUFields>, responseCallback?: PDUCallback, sendCallback?: SendCallback, failureCallback?: FailureCallback): void;
    submit_sm(options: Partial<PDUFields>, responseCallback?: PDUCallback, sendCallback?: SendCallback, failureCallback?: FailureCallback): void;
    deliver_sm(options: Partial<PDUFields>, responseCallback?: PDUCallback, sendCallback?: SendCallback, failureCallback?: FailureCallback): void;
    enquire_link(options?: Partial<PDUFields>, responseCallback?: PDUCallback, sendCallback?: SendCallback, failureCallback?: FailureCallback): void;
    unbind(options?: Partial<PDUFields>, responseCallback?: PDUCallback, sendCallback?: SendCallback, failureCallback?: FailureCallback): void;
    query_sm(options: Partial<PDUFields>, responseCallback?: PDUCallback, sendCallback?: SendCallback, failureCallback?: FailureCallback): void;

    // Events
    on(event: 'connect', listener: () => void): this;
    on(event: 'secureConnect', listener: () => void): this;
    on(event: 'close', listener: () => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: 'send', listener: (pdu: PDU) => void): this;
    on(event: 'pdu', listener: (pdu: PDU) => void): this;
    on(event: 'bind_transceiver', listener: (pdu: PDU) => void): this;
    on(event: 'bind_transmitter', listener: (pdu: PDU) => void): this;
    on(event: 'bind_receiver', listener: (pdu: PDU) => void): this;
    on(event: 'submit_sm', listener: (pdu: PDU) => void): this;
    on(event: 'deliver_sm', listener: (pdu: PDU) => void): this;
    on(event: 'deliver_sm_resp', listener: (pdu: PDU) => void): this;
    on(event: 'enquire_link', listener: (pdu: PDU) => void): this;
    on(event: 'unbind', listener: (pdu: PDU) => void): this;
    on(event: 'generic_nack', listener: (pdu: PDU) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }

  // ── Server ───────────────────────────────────────────────────────

  interface ServerOptions extends Partial<TlsOptions> {
    enable_proxy_protocol_detection?: boolean;
    debug?: boolean;
    debugListener?: (type: string, msg: string, payload: unknown) => void;
  }

  interface SmppServer extends NetServer {
    sessions: Session[];
    tls: boolean;
  }

  // ── Module exports ───────────────────────────────────────────────

  function createServer(listener: (session: Session) => void): SmppServer;
  function createServer(options: ServerOptions, listener: (session: Session) => void): SmppServer;
  function connect(options: { host: string; port: number; tls?: boolean; auto_enquire_link_period?: number; [key: string]: unknown }, listener?: () => void): Session;
  function connect(url: string, listener?: () => void): Session;
  function addCommand(command: string, options: unknown): void;
  function addTLV(tag: string, options: unknown): void;

  // ── Error codes ──────────────────────────────────────────────────

  const ESME_ROK: 0x00000000;
  const ESME_RINVMSGLEN: 0x00000001;
  const ESME_RINVCMDLEN: 0x00000002;
  const ESME_RINVCMDID: 0x00000003;
  const ESME_RINVBNDSTS: 0x00000004;
  const ESME_RALYBND: 0x00000005;
  const ESME_RINVPRTFLG: 0x00000006;
  const ESME_RINVREGDLVFLG: 0x00000007;
  const ESME_RSYSERR: 0x00000008;
  const ESME_RINVSRCADR: 0x0000000A;
  const ESME_RINVDSTADR: 0x0000000B;
  const ESME_RINVMSGID: 0x0000000C;
  const ESME_RBINDFAIL: 0x0000000D;
  const ESME_RINVPASWD: 0x0000000E;
  const ESME_RINVSYSID: 0x0000000F;
  const ESME_RCANCELFAIL: 0x00000011;
  const ESME_RREPLACEFAIL: 0x00000013;
  const ESME_RMSGQFUL: 0x00000014;
  const ESME_RINVSERTYP: 0x00000015;
  const ESME_RSUBMITFAIL: 0x00000045;
  const ESME_RTHROTTLED: 0x00000058;
  const ESME_RUNKNOWNERR: 0x000000FF;

  // ── Constants ────────────────────────────────────────────────────

  const TON: {
    UNKNOWN: 0x00;
    INTERNATIONAL: 0x01;
    NATIONAL: 0x02;
    NETWORK_SPECIFIC: 0x03;
    SUBSCRIBER_NUMBER: 0x04;
    ALPHANUMERIC: 0x05;
    ABBREVIATED: 0x06;
  };

  const NPI: {
    UNKNOWN: 0x00;
    ISDN: 0x01;
    DATA: 0x03;
    TELEX: 0x04;
    LAND_MOBILE: 0x06;
    NATIONAL: 0x08;
    PRIVATE: 0x09;
    ERMES: 0x0A;
    INTERNET: 0x0E;
    IP: 0x0E;
    WAP: 0x12;
  };

  const ENCODING: {
    SMSC_DEFAULT: 0x00;
    ASCII: 0x01;
    IA5: 0x01;
    LATIN1: 0x03;
    ISO_8859_1: 0x03;
    BINARY: 0x04;
    CYRILLIC: 0x06;
    HEBREW: 0x07;
    UCS2: 0x08;
  };

  const ESM_CLASS: {
    DATAGRAM: 0x01;
    FORWARD: 0x02;
    STORE_FORWARD: 0x03;
    MC_DELIVERY_RECEIPT: 0x04;
    DELIVERY_ACKNOWLEDGEMENT: 0x08;
    USER_ACKNOWLEDGEMENT: 0x10;
    CONVERSATION_ABORT: 0x18;
    INTERMEDIATE_DELIVERY: 0x20;
    UDH_INDICATOR: 0x40;
    SET_REPLY_PATH: 0x80;
  };

  const REGISTERED_DELIVERY: {
    FINAL: 0x01;
    FAILURE: 0x02;
    SUCCESS: 0x03;
    DELIVERY_ACKNOWLEDGEMENT: 0x04;
    USER_ACKNOWLEDGEMENT: 0x08;
    INTERMEDIATE: 0x10;
  };

  const MESSAGE_STATE: {
    SCHEDULED: 0;
    ENROUTE: 1;
    DELIVERED: 2;
    EXPIRED: 3;
    DELETED: 4;
    UNDELIVERABLE: 5;
    ACCEPTED: 6;
    UNKNOWN: 7;
    REJECTED: 8;
    SKIPPED: 9;
  };

  export {
    PDU,
    Session,
    SmppServer,
    ServerOptions,
    PDUFields,
    PDUCallback,
    createServer,
    connect,
    addCommand,
    addTLV,
    ESME_ROK,
    ESME_RINVMSGLEN,
    ESME_RINVCMDLEN,
    ESME_RINVCMDID,
    ESME_RINVBNDSTS,
    ESME_RALYBND,
    ESME_RINVPRTFLG,
    ESME_RINVREGDLVFLG,
    ESME_RSYSERR,
    ESME_RINVSRCADR,
    ESME_RINVDSTADR,
    ESME_RINVMSGID,
    ESME_RBINDFAIL,
    ESME_RINVPASWD,
    ESME_RINVSYSID,
    ESME_RCANCELFAIL,
    ESME_RREPLACEFAIL,
    ESME_RMSGQFUL,
    ESME_RINVSERTYP,
    ESME_RSUBMITFAIL,
    ESME_RTHROTTLED,
    ESME_RUNKNOWNERR,
    TON,
    NPI,
    ENCODING,
    ESM_CLASS,
    REGISTERED_DELIVERY,
    MESSAGE_STATE,
  };
}
