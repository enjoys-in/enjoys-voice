/**
 * Comprehensive TypeScript declarations for `drachtio-srf` v5.0.20
 *
 * ────────────────────────────────────────────────────────────────────────
 *  ⚠️  BACKUP / REFERENCE ONLY — THIS FILE IS NOT WIRED INTO THE BUILD.
 * ────────────────────────────────────────────────────────────────────────
 * The npm package ships its own (thinner, partially inaccurate) types at
 * `node_modules/drachtio-srf/lib/@types/index.d.ts`, referenced through its
 * `package.json` "types" field — and THAT is what the project currently
 * compiles against. This file lives outside the module-resolution path for
 * `drachtio-srf` (it is a standalone module declaration, not a
 * `declare module 'drachtio-srf'` augmentation), so importing the real
 * package is completely unaffected by its presence.
 *
 * It was hand-reconstructed from the library source (lib/srf.js, dialog.js,
 * request.js, response.js, proto.js, drachtio-agent.js, sip-parser/*) and the
 * test suite, and captures the FULL runtime surface the shipped types omit:
 *   • every overload (Promise form AND callback form) per method
 *   • complete option-object shapes for createUAS/UAC/B2BUA/proxyRequest/etc.
 *   • delegated members (delegates lib) on Srf/Request/Response
 *   • all emitted events with typed listener arguments
 *   • parseUri/stringifyUri, SipError, DialogState/DialogDirection constants
 *   • the 3PCC (noAck) result shapes for createUAC and Dialog#modify
 *
 * To adopt it later, copy its body over the package's shipped index.d.ts (or
 * add a tsconfig `paths` mapping for "drachtio-srf"). Until then it has zero
 * effect on type-checking of the rest of the codebase.
 *
 * @see https://github.com/drachtio/drachtio-srf
 */

import { Socket } from 'net';
import { Server } from 'net';
import { EventEmitter } from 'events';

export = Srf;

/**
 * Applications create an instance of `Srf` to create and manage SIP
 * {@link Srf.Dialog | Dialogs} and SIP transactions. A single instance is
 * sufficient for most cases.
 */
declare class Srf extends EventEmitter {
  /** Create an instance with no tags. */
  constructor();
  /** Create an instance with a single routing tag (max 32 chars). */
  constructor(tag: string);
  /** Create an instance with multiple routing tags (max 20, 32 chars each). */
  constructor(tags: string[]);
  /** Create an instance and immediately connect using the given options. */
  constructor(opts: Srf.SrfConfig & { host: string });

  /** The underlying drachtio app/agent object. */
  readonly app: unknown;
  /** Per-application key/value store (delegated to the agent). */
  locals: { [name: string]: unknown };
  /** True when the connection to the drachtio server is idle. */
  readonly idle: boolean;
  /** The underlying TCP socket to the drachtio server. */
  socket: Socket;

  /**
   * Connect to a drachtio server (outbound connection model). Completion is
   * signalled by the `connect` event rather than the return value.
   */
  connect(opts?: Srf.SrfConfig, callback?: (err: Error | null, hostport: string) => void): this;

  /**
   * Listen for inbound TCP connections from drachtio servers (inbound model).
   * Returns the underlying server.
   */
  listen(opts: Srf.SrfConfig, callback?: () => void): Server;

  /** Disconnect from the drachtio server. */
  disconnect(): void;

  /** Cleanly end the session associated with the current request. */
  endSession(req: Srf.SrfRequest): void;

  /** Set an application-level configuration value (delegated). */
  set(key: string, value: unknown): this;
  /** Get an application-level configuration value (delegated). */
  get(key: string): unknown;

  /** Register middleware run for every incoming request. */
  use(callback: Srf.MiddlewareHandler): void;
  /** Register middleware run for a specific SIP method. */
  use(messageType: Srf.SipMethod | Lowercase<Srf.SipMethod>, callback: Srf.MiddlewareHandler): void;

  // ─── Request-routing handlers (delegated SIP verbs) ──────────────────
  invite(handler: Srf.SipRequestHandler): this;
  register(handler: Srf.SipRequestHandler): this;
  bye(handler: Srf.SipRequestHandler): this;
  options(handler: Srf.SipRequestHandler): this;
  info(handler: Srf.SipRequestHandler): this;
  message(handler: Srf.SipRequestHandler): this;
  notify(handler: Srf.SipRequestHandler): this;
  cancel(handler: Srf.SipRequestHandler): this;
  update(handler: Srf.SipRequestHandler): this;
  prack(handler: Srf.SipRequestHandler): this;
  ack(handler: Srf.SipRequestHandler): this;
  refer(handler: Srf.SipRequestHandler): this;
  publish(handler: Srf.SipRequestHandler): this;
  subscribe(handler: Srf.SipRequestHandler): this;

  /**
   * Send an arbitrary SIP request not associated with an existing dialog.
   * Promise resolves to the request that was sent.
   */
  request(uri: string, opts: Srf.SendRequestOptions): Promise<Srf.SrfRequest>;
  request(opts: Srf.SendRequestOptions & { uri: string }): Promise<Srf.SrfRequest>;
  request(uri: string, opts: Srf.SendRequestOptions, callback: (err: Error | null, req: Srf.SrfRequest) => void): this;
  request(opts: Srf.SendRequestOptions & { uri: string }, callback: (err: Error | null, req: Srf.SrfRequest) => void): this;
  request(socket: Socket, uri: string, opts: Srf.SendRequestOptions, callback?: (err: Error | null, req: Srf.SrfRequest) => void): this;

  /**
   * Proxy an incoming request to one or more destinations.
   * @param destination one or more SIP URIs to proxy toward.
   */
  proxyRequest(req: Srf.SrfRequest, destination?: string | string[], opts?: Srf.ProxyRequestOptions): Promise<Srf.ProxyResults>;
  proxyRequest(req: Srf.SrfRequest, destination: string | string[], opts: Srf.ProxyRequestOptions, callback: (err: Error | null, results: Srf.ProxyResults) => void): this;
  proxyRequest(req: Srf.SrfRequest, destination: string | string[], callback: (err: Error | null, results: Srf.ProxyResults) => void): this;

  /**
   * Create a UAS (user-agent server) dialog by answering an incoming INVITE
   * (sends 200 OK) or SUBSCRIBE (sends 202 Accepted).
   * @returns a Promise that resolves to the Dialog, or `this` when a callback
   * is supplied.
   */
  createUAS(req: Srf.SrfRequest, res: Srf.SrfResponse, opts?: Srf.CreateUASOptions): Promise<Srf.Dialog>;
  createUAS(req: Srf.SrfRequest, res: Srf.SrfResponse, opts: Srf.CreateUASOptions, callback: (err: Error | null, dialog: Srf.Dialog) => void): this;

  /**
   * Create a UAC (user-agent client) dialog by sending an INVITE or SUBSCRIBE.
   * In the 3PCC `noAck: true` case the Promise resolves to a {@link Srf.UacAckResult}
   * instead of a Dialog.
   */
  createUAC(uri: string, opts: Srf.CreateUACOptions & { noAck: true }, progressCallbacks?: Srf.ProgressCallbacks): Promise<Srf.UacAckResult>;
  createUAC(uri: string, opts?: Srf.CreateUACOptions, progressCallbacks?: Srf.ProgressCallbacks): Promise<Srf.Dialog>;
  createUAC(opts: Srf.CreateUACOptions & { uri: string; noAck: true }, progressCallbacks?: Srf.ProgressCallbacks): Promise<Srf.UacAckResult>;
  createUAC(opts: Srf.CreateUACOptions & { uri: string }, progressCallbacks?: Srf.ProgressCallbacks): Promise<Srf.Dialog>;
  createUAC(uri: string, opts: Srf.CreateUACOptions, progressCallbacks: Srf.ProgressCallbacks, callback: (err: Error | null, dialog: Srf.Dialog) => void): this;
  createUAC(uri: string, opts: Srf.CreateUACOptions, callback: (err: Error | null, dialog: Srf.Dialog) => void): this;

  /**
   * Create a back-to-back user agent, bridging an incoming request to a new
   * outgoing dialog. Resolves to `{ uas, uac }`.
   */
  createB2BUA(req: Srf.SrfRequest, res: Srf.SrfResponse, uri: string, opts?: Srf.CreateB2BUAOptions, progressCallbacks?: Srf.B2buaProgressCallbacks): Promise<Srf.B2buaResult>;
  createB2BUA(req: Srf.SrfRequest, res: Srf.SrfResponse, opts: Srf.CreateB2BUAOptions & { uri: string }, progressCallbacks?: Srf.B2buaProgressCallbacks): Promise<Srf.B2buaResult>;
  createB2BUA(req: Srf.SrfRequest, res: Srf.SrfResponse, uri: string, opts: Srf.CreateB2BUAOptions, progressCallbacks: Srf.B2buaProgressCallbacks, callback: (err: Error | null, result: Srf.B2buaResult) => void): this;
  createB2BUA(req: Srf.SrfRequest, res: Srf.SrfResponse, uri: string, opts: Srf.CreateB2BUAOptions, callback: (err: Error | null, result: Srf.B2buaResult) => void): this;

  // ─── Dialog registry ─────────────────────────────────────────────────
  findDialogById(stackDialogId: string): Srf.Dialog | undefined;
  findDialogByCallIDAndFromTag(callId: string, tag: string): Srf.Dialog | undefined;
  addDialog(dialog: Srf.Dialog): void;
  removeDialog(dialog: Srf.Dialog): void;

  /** Stop receiving (server-routed) notifications for a SIP method. */
  unregisterForMessages(sipVerb: Srf.SipMethod | Lowercase<Srf.SipMethod>): void;
  /** Resume receiving notifications for a SIP method previously unregistered. */
  reregisterForMessages(sipVerb: Srf.SipMethod | Lowercase<Srf.SipMethod>): void;

  // ─── Events ───────────────────────────────────────────────────────────
  on(event: 'connect', listener: (err: Error | null, hostport: string, serverVersion?: string, localHostports?: string) => void): this;
  on(event: 'listening', listener: () => void): this;
  on(event: 'reconnecting', listener: (opts: { delay: number; attempts: number }) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'close', listener: (hadError?: boolean) => void): this;
  on(event: 'message', listener: (req: Srf.SrfRequest, res: Srf.SrfResponse) => void): this;
  on(event: 'request', listener: (req: Srf.SrfRequest, res: Srf.SrfResponse) => void): this;
  on(
    event: 'register' | 'invite' | 'bye' | 'cancel' | 'ack' | 'info' | 'notify'
      | 'options' | 'prack' | 'publish' | 'refer' | 'subscribe' | 'update' | 'message',
    listener: (req: Srf.SrfRequest, res: Srf.SrfResponse) => void,
  ): this;
  on(event: 'cdr:attempt', listener: (source: 'network' | 'application', time: string, msg: Srf.SipMessage) => void): this;
  on(event: 'cdr:start', listener: (source: 'network' | 'application', time: string, role: string, msg: Srf.SipMessage) => void): this;
  on(event: 'cdr:stop', listener: (source: 'network' | 'application', time: string, reason: string, msg: Srf.SipMessage) => void): this;
  on(event: string, listener: (...args: any[]) => void): this;

  // ─── Statics (re-exports) ─────────────────────────────────────────────
  /** Parse a SIP/SIPS/TEL URI into its components. */
  static parseUri: typeof Srf.parseUri;
  /** Serialize a parsed URI object (or pass through a string) into a URI. */
  static stringifyUri: typeof Srf.stringifyUri;
  /** The {@link Srf.SipError} class. */
  static SipError: typeof Srf.SipError;
  /** The {@link Srf.Dialog} class. */
  static Dialog: typeof Srf.Dialog;
  /** The SipMessage parser class. */
  static SipMessage: { new (msg?: string): Srf.SipMessage; parseUri(uri: string): Srf.ParseUriResult };
  /** The Request runtime class. */
  static SipRequest: { new (...args: any[]): Srf.SrfRequest };
  /** The Response runtime class. */
  static SipResponse: { new (...args: any[]): Srf.SrfResponse };
  /** Enumeration of dialog lifecycle states emitted via `dialogStateEmitter`. */
  static DialogState: {
    readonly Trying: 'trying';
    readonly Proceeding: 'proceeding';
    readonly Early: 'early';
    readonly Confirmed: 'confirmed';
    readonly Terminated: 'terminated';
    readonly Rejected: 'rejected';
    readonly Cancelled: 'cancelled';
  };
  /** Enumeration of dialog directions. */
  static DialogDirection: {
    readonly Initiator: 'initiator';
    readonly Recipient: 'recipient';
  };
}

declare namespace Srf {
  // ─── Primitive / shared types ───────────────────────────────────────
  type SipMethod =
    | 'ACK' | 'BYE' | 'CANCEL' | 'INFO' | 'INVITE' | 'MESSAGE' | 'NOTIFY'
    | 'OPTIONS' | 'PRACK' | 'PUBLISH' | 'REFER' | 'REGISTER' | 'SUBSCRIBE' | 'UPDATE';
  type SipMessageHeaders = Record<string, string>;
  type DialogType = 'uac' | 'uas';
  type DialogStateValue =
    | 'trying' | 'proceeding' | 'early' | 'confirmed' | 'terminated' | 'rejected' | 'cancelled';
  type DialogDirectionValue = 'initiator' | 'recipient';

  /** An address-of-record (parsed To/From/Contact/etc. header). */
  type AOR = { name: string; uri: string; params?: Record<string, string | null> };
  /** A parsed Via header. */
  type Via = { version: string; protocol: string; host: string; port: string };

  /** SIP digest credentials, or a callback that supplies them on challenge. */
  type SipAuth = { username: string; password: string };
  type SipAuthCallback = (req: SrfRequest, res: SrfResponse, callback: (err: Error | null, auth?: SipAuth) => void) => void;

  type MiddlewareHandler = (req: SrfRequest, res: SrfResponse, next: () => void) => void;
  type SipRequestHandler = (req: SrfRequest, res: SrfResponse, next?: () => void) => void;

  interface SrfConfig {
    host?: string;
    port?: number;
    secret?: string;
    tags?: string[];
    logger?: (message: string) => void;
  }

  // ─── URI parsing ─────────────────────────────────────────────────────
  interface ParseUriResult {
    family?: 'ipv6' | 'ipv4';
    scheme: 'sip' | 'sips' | 'tel';
    user?: string;
    password?: string;
    host?: string;
    /** Numeric at runtime (parsed via unary `+`); `NaN` when absent. */
    port?: number;
    params: Record<string, string | null>;
    headers: Record<string, string>;
    /** `tel:` URIs only. */
    number?: string;
    /** `tel:` URIs only. */
    context?: string;
  }

  function parseUri(uri: string): ParseUriResult;
  function stringifyUri(uri: ParseUriResult | Partial<ParseUriResult> | string): string;

  // ─── SipMessage (base parser object) ─────────────────────────────────
  interface SipMessage {
    type: 'request' | 'response' | 'unknown';
    method?: SipMethod;
    uri?: string;
    version?: string;
    status?: number;
    reason?: string;
    headers: SipMessageHeaders;
    body: string;
    payload: { type: string | null; content?: string }[];
    readonly raw: string;
    readonly calledNumber: string;
    readonly callingNumber: string;
    readonly callingName: string;
    readonly canFormDialog: boolean;

    get(name: string): string;
    has(name: string): boolean;
    set(name: string, value: string): void;
    set(headers: Record<string, string>): void;
    getHeaderName(name: string): string;
    getParsedHeader(name: 'contact' | 'Contact'): AOR[];
    getParsedHeader(name: 'via' | 'Via'): Via[];
    getParsedHeader(
      name: 'To' | 'to' | 'From' | 'from' | 'refer-to' | 'referred-by' | 'p-asserted-identity' | 'remote-party-id',
    ): AOR;
    getParsedHeader(name: string): string;
    toString(): string;
  }

  /** Transport / stack metadata attached to inbound Request & Response objects. */
  interface MessageMeta {
    source: 'network' | 'application';
    source_address: string;
    source_port: string;
    protocol: string;
    stackTime: string;
    stackTxnId: string;
    stackDialogId: string;
    receivedOn?: string;
    server?: string;
    sessionToken?: string;
  }

  // ─── SrfRequest ──────────────────────────────────────────────────────
  interface SrfRequest extends SipMessage, MessageMeta {
    method: SipMethod;
    /** True when this is an initial INVITE (no to-tag). */
    readonly isNewInvite: boolean;
    /** Alias of `uri`. */
    readonly url: string;
    uri: string;
    srf: Srf;
    agent: unknown;
    meta: MessageMeta;
    /** The paired response object (UAS flows). */
    res: SrfResponse;
    /** The underlying SipMessage. */
    msg: SipMessage;
    /** Convenience access to the request SDP body. */
    sdp: string;
    branch: string;
    callId: string;
    from: string;
    to: string;
    /** Present on REGISTER requests. */
    registration?: {
      type: 'register' | 'unregister';
      expires: number;
      contact: AOR[];
      aor: string;
    };

    /** Cancel a pending outbound (UAC) request. Throws if not application-sourced. */
    cancel(callback: (err: Error | null, req: SrfRequest) => void): void;
    cancel(opts?: { headers?: SipMessageHeaders }, callback?: (err: Error | null, req: SrfRequest) => void): void;

    /** Proxy this (network-sourced) request. Throws if not network-sourced. */
    proxy(opts?: ProxyRequestOptions): Promise<ProxyResults>;
    proxy(opts: ProxyRequestOptions, callback: (err: Error | null, results: ProxyResults) => void): SrfRequest;

    // passport.js compatibility
    logIn(user: unknown, options?: unknown, done?: (err?: Error) => void): void;
    logOut(): void;
    isAuthenticated(): boolean;
    isUnauthenticated(): boolean;

    on(event: 'response', listener: (res: SrfResponse, ack?: (opts?: { sdp: string }) => void) => void): this;
    on(event: 'cancel', listener: (msg: SipMessage) => void): this;
    on(event: 'authenticate', listener: (req: SrfRequest) => void): this;
    on(event: 'update', listener: (req: SrfRequest, res: SrfResponse) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
  }

  // ─── SrfResponse ─────────────────────────────────────────────────────
  interface SrfResponse extends SipMessage, MessageMeta {
    status: number;
    /** Alias of `status`. */
    statusCode: number;
    reason: string;
    req: SrfRequest;
    agent: unknown;
    meta: MessageMeta;
    msg: SipMessage;
    finished: boolean;
    readonly finalResponseSent: boolean;
    readonly headersSent: boolean;

    /**
     * Send a SIP response. The optional final `fnPrack` callback is invoked
     * with the incoming PRACK (reliable provisional) or ACK (200 to INVITE).
     */
    send(status: number): void;
    send(status: number, callback: (err: Error | null, msg: SipMessage) => void): void;
    send(status: number, opts: SendResponseOptions): void;
    send(status: number, opts: SendResponseOptions, callback: (err: Error | null, msg: SipMessage) => void): void;
    send(status: number, reason: string, opts: SendResponseOptions): void;
    send(status: number, reason: string, opts: SendResponseOptions, callback: (err: Error | null, msg: SipMessage) => void): void;
    send(
      status: number,
      reason: string,
      opts: SendResponseOptions,
      callback: ((err: Error | null, msg: SipMessage) => void) | undefined,
      fnPrack: (req: SrfRequest) => void,
    ): void;

    sendAck(dialogId: string, opts?: { headers?: SipMessageHeaders; body?: string }, callback?: (err: Error | null, msg: SipMessage) => void): void;
    sendPrack(dialogId: string, opts?: { headers?: SipMessageHeaders; body?: string }, callback?: (err: Error | null, msg: SipMessage) => void): void;

    getHeader(name: string): string;
    setHeader(name: string, value: string): void;
    /** No-op (present for http.ServerResponse compatibility). */
    removeHeader(name: string): void;
    end(data?: string, encoding?: string, callback?: () => void): void;
    toJSON(): object;

    on(event: 'end', listener: (info: { status: number; reason: string }) => void): this;
    on(event: 'finish', listener: () => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
  }

  interface SendResponseOptions {
    headers?: SipMessageHeaders;
    body?: string;
  }

  // ─── Dialog ──────────────────────────────────────────────────────────
  class Dialog extends EventEmitter {
    constructor(srf: Srf, type: DialogType, opts: object);

    srf: Srf;
    type: DialogType;
    req: SrfRequest;
    res: SrfResponse;
    onHold: boolean;
    connected: boolean;
    /** Active subscription URIs (SUBSCRIBE dialogs). */
    subscriptions: string[];
    /** The paired dialog in a B2BUA bridge. */
    other?: Dialog;
    sip: { callId: string; localTag: string; remoteTag: string };
    local: { uri: string; sdp: string; contact: string };
    remote: { uri: string; sdp: string };

    readonly id: string;
    /** The SIP method that created the dialog (INVITE or SUBSCRIBE). */
    readonly dialogType: SipMethod;
    /** The Event header value (SUBSCRIBE dialogs only). */
    readonly subscribeEvent?: string;
    readonly socket: Socket;

    /** Attach an emitter that receives dialog `stateChange` events. */
    set stateEmitter(arg: { emitter: EventEmitter; state?: DialogStateValue });
    /** When true, outbound in-dialog requests are queued and drained on false. */
    set queueRequests(arg: boolean);

    getCountOfSubscriptions(): number;
    addSubscription(req: SrfRequest): void;
    removeSubscription(uri: string, event: string): void;
    toJSON(): object;
    toString(): string;

    /**
     * Tear down the dialog: sends BYE (INVITE dialogs) or a terminating
     * NOTIFY (SUBSCRIBE dialogs).
     * @returns a Promise resolving to the request sent, or `this` with a callback.
     */
    destroy(opts?: { headers?: SipMessageHeaders; auth?: SipAuth | SipAuthCallback }): Promise<SrfRequest>;
    destroy(opts: { headers?: SipMessageHeaders; auth?: SipAuth | SipAuthCallback }, callback: (err: Error | null, msg: SrfRequest) => void): this;
    destroy(callback: (err: Error | null, msg: SrfRequest) => void): this;

    /**
     * Re-INVITE to modify the session. `sdp` may be a raw SDP, or the literals
     * `'hold'` / `'unhold'`. In the 3PCC `noAck` case the result carries an
     * `ack` continuation instead of a plain SDP string.
     */
    modify(sdp: 'hold' | 'unhold' | string, opts?: { headers?: SipMessageHeaders; auth?: SipAuth | SipAuthCallback }): Promise<string>;
    modify(opts: { headers?: SipMessageHeaders; auth?: SipAuth | SipAuthCallback }): Promise<string>;
    modify(sdp: 'hold' | 'unhold' | string, opts: { noAck: true; headers?: SipMessageHeaders }): Promise<DialogModifyAckResult>;
    modify(sdp: 'hold' | 'unhold' | string, opts: { headers?: SipMessageHeaders; auth?: SipAuth | SipAuthCallback }, callback: (err: Error | null, sdp: string) => void): this;
    modify(opts: { noAck: boolean; headers?: SipMessageHeaders }, callback: (err: Error | null, sdp?: string, ack?: (sdp: string) => Promise<void>) => void): this;

    /**
     * Send an in-dialog request. With `noAck: true` on an INVITE returning 200,
     * the callback receives a third `ack` continuation argument.
     */
    request(opts: DialogRequestOptions): Promise<SrfResponse>;
    request(opts: DialogRequestOptions, callback: (err: Error | null, res: SrfResponse, ack?: (opts?: { body?: string }) => void) => void): this;

    // Convenience in-dialog verb methods (generated from sip-methods).
    invite: DialogVerb;
    bye: DialogVerb;
    register: DialogVerb;
    info: DialogVerb;
    subscribe: DialogVerb;
    options: DialogVerb;
    message: DialogVerb;
    notify: DialogVerb;
    cancel: DialogVerb;
    update: DialogVerb;
    prack: DialogVerb;
    ack: DialogVerb;
    refer: DialogVerb;
    publish: DialogVerb;

    on(event: 'destroy', listener: (req: SrfRequest, reason?: string) => void): this;
    on(event: 'ack' | 'refresh' | 'hold' | 'unhold', listener: (req: SrfRequest) => void): this;
    on(
      event: 'modify' | 'info' | 'message' | 'notify' | 'options' | 'refer' | 'update' | 'publish' | 'subscribe',
      listener: (req: SrfRequest, res: SrfResponse) => void,
    ): this;
    on(event: 'unsubscribe', listener: (req: SrfRequest, reason: 'unsubscribe') => void): this;
    once(event: string, listener: (...args: any[]) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
  }

  /** Overload set shared by Dialog's in-dialog convenience verb methods. */
  interface DialogVerb {
    (opts?: DialogRequestOptions): Promise<SrfResponse>;
    (opts: DialogRequestOptions, callback: (err: Error | null, res: SrfResponse) => void): Dialog;
    (callback: (err: Error | null, res: SrfResponse) => void): Dialog;
  }

  interface DialogRequestOptions {
    method?: SipMethod;
    headers?: SipMessageHeaders;
    body?: string;
    auth?: SipAuth | SipAuthCallback;
    noAck?: boolean;
  }

  /** Result of a 3PCC `noAck` Dialog#modify: SDP plus an `ack` continuation. */
  interface DialogModifyAckResult {
    sdp: string;
    ack(sdp: string): Promise<void>;
  }

  // ─── Operation option objects ────────────────────────────────────────
  interface CreateUASOptions {
    /** Local SDP to answer with. */
    localSdp?: string | (() => string | Promise<string>);
    /** Alias for `localSdp` (preferred when both are present). */
    body?: string | (() => string | Promise<string>);
    headers?: SipMessageHeaders;
    /** Emitter that receives dialog `stateChange` events. */
    dialogStateEmitter?: EventEmitter;
  }

  interface CreateUACOptions {
    uri?: string;
    /** @default 'INVITE' */
    method?: 'INVITE' | 'SUBSCRIBE';
    headers?: SipMessageHeaders;
    localSdp?: string;
    body?: string;
    proxy?: string;
    auth?: SipAuth | SipAuthCallback;
    callingNumber?: string;
    callingName?: string;
    calledNumber?: string;
    followRedirects?: boolean;
    keepUriOnRedirect?: boolean;
    /** Skip sending ACK (3PCC); resolves to a {@link UacAckResult}. */
    noAck?: boolean;
    dialogStateEmitter?: EventEmitter;
    _socket?: Socket;
  }

  interface CreateB2BUAOptions {
    uri?: string;
    headers?: SipMessageHeaders;
    responseHeaders?: SipMessageHeaders | ((uacRes: SipMessageHeaders, headers: SipMessageHeaders) => SipMessageHeaders | null);
    localSdpA?: string | ((sdp: string, res: SrfResponse) => string | Promise<string>);
    localSdpB?: string | ((sdp: string) => string | Promise<string>);
    proxyRequestHeaders?: string[];
    proxyResponseHeaders?: string[];
    passFailure?: boolean;
    passProvisionalResponses?: boolean;
    proxy?: string;
    auth?: SipAuth | SipAuthCallback;
    callingNumber?: string;
    callingName?: string;
    calledNumber?: string;
    noAck?: boolean;
    _socket?: Socket;
    dialogStateEmitter?: EventEmitter;
  }

  interface ProxyRequestOptions {
    destination?: string | string[];
    /** @default 'sequential' */
    forking?: 'sequential' | 'simultaneous';
    remainInDialog?: boolean;
    recordRoute?: boolean;
    path?: boolean;
    provisionalTimeout?: string;
    finalTimeout?: string;
    followRedirects?: boolean;
    headers?: SipMessageHeaders;
  }

  interface SendRequestOptions {
    method: SipMethod;
    uri?: string;
    headers?: SipMessageHeaders;
    body?: string;
    auth?: SipAuth | SipAuthCallback;
    proxy?: string;
    _socket?: Socket;
  }

  interface ProgressCallbacks {
    /** Invoked once the outbound request has been sent. */
    cbRequest?: (err: Error | null, req: SrfRequest) => void;
    /** Invoked for each provisional (1xx) response received. */
    cbProvisional?: (provisionalRes: SrfResponse) => void;
  }

  interface B2buaProgressCallbacks extends ProgressCallbacks {
    /** Invoked once the UAC dialog is finalized. */
    cbFinalizedUac?: (uac: Dialog) => void;
  }

  // ─── Operation results ───────────────────────────────────────────────
  /** Result of `createB2BUA`: the two bridged dialog legs. */
  interface B2buaResult {
    uas: Dialog;
    uac: Dialog;
  }

  /** Result of a 3PCC `createUAC({ noAck: true })`. */
  interface UacAckResult {
    sdp: string;
    res: SrfResponse;
    /** Complete the dialog by sending the ACK with the supplied local SDP. */
    ack(localSdp?: string): Promise<Dialog>;
  }

  /** Result delivered to `proxyRequest`/`SrfRequest#proxy` callbacks. */
  interface ProxyResults {
    connected: boolean;
    responses: SipMessage[];
  }

  // ─── SipError ────────────────────────────────────────────────────────
  /** Thrown / rejected when a UAC transaction receives a non-success final response. */
  class SipError extends Error {
    constructor(status: number, reason?: string);
    name: 'SipError';
    status: number;
    reason?: string;
  }
}
