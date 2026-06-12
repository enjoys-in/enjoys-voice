/**
 * Type definitions for `drachtio-fsmrf` v4.1.2
 *
 * The published package ships no types, so these are maintained locally.
 * They are hand-written from the library source (lib/mrf.js, mediaserver.js,
 * endpoint.js, conference.js) and cover the real, public API surface —
 * including the dual Promise/callback form that every async method exposes
 * (passing a callback returns the instance for chaining; omitting it returns a
 * Promise).
 *
 * Cross-references to drachtio-srf reuse that package's own shipped types.
 */
declare module 'drachtio-fsmrf' {
  import { EventEmitter } from 'events';
  import Srf = require('drachtio-srf');

  export = Mrf;

  /**
   * Media Resource Framework — the entry point. Wraps a drachtio `Srf`
   * instance and connects to one or more FreeSWITCH media servers.
   */
  class Mrf extends EventEmitter {
    constructor(srf: Srf, opts?: Mrf.MrfOptions);

    /** The underlying drachtio Srf instance. */
    readonly srf: Srf;

    /** Connect to a FreeSWITCH media server over the event socket (ESL). */
    connect(
      opts: Mrf.ConnectOptions,
      callback: (err: Error | null, ms: Mrf.MediaServer) => void,
    ): void;
    connect(opts: Mrf.ConnectOptions): Promise<Mrf.MediaServer>;

    /** Library helpers exposed as statics. */
    static utils: {
      parseBodyText(txt: string): Record<string, string | number>;
    };
  }

  namespace Mrf {
    // ─── Construction / connection ──────────────────────────────────────

    interface MrfOptions {
      /** Directory to write ESL message-trace files into (enables tracing). */
      debugDir?: string;
      /** Advertise media as sendonly. */
      sendonly?: boolean;
      /** Extra FreeSWITCH CUSTOM events to subscribe to (without the
       *  `CUSTOM ` prefix), made available on endpoints. */
      customEvents?: string[];
    }

    interface ConnectOptions {
      /** Hostname or IP of the FreeSWITCH server. */
      address: string;
      /** ESL port. @default 8021 */
      port?: number;
      /** ESL auth secret. @default 'ClueCon' */
      secret?: string;
      /** Local TCP port to listen on for outbound ESL connections.
       *  @default 0 (any free port) */
      listenPort?: number;
      /** Local TCP address to bind the outbound-ESL listener to.
       *  @default first non-internal IPv4 address, else '0.0.0.0' */
      listenAddress?: string;
      /** Address advertised to FreeSWITCH for the outbound connection
       *  (use when behind NAT). @default listenAddress */
      advertisedAddress?: string;
      /** Port advertised to FreeSWITCH. @default listenPort */
      advertisedPort?: number;
      /** FreeSWITCH sofia profile used for media dialogs.
       *  @default 'drachtio_mrf' */
      profile?: string;
    }

    type Family = 'ipv4' | 'ipv6';

    interface EndpointOptions {
      /** Remote SDP. If omitted, an inactive (3pcc) endpoint is created. */
      remoteSdp?: string;
      /** Preferred codecs, in order (e.g. ['OPUS','PCMU']). */
      codecs?: string | string[];
      family?: Family;
      /** Require a DTLS endpoint. */
      dtls?: boolean;
      /** Use SRTP (for 3pcc endpoints). */
      srtp?: boolean;
      /** Extra SIP headers to add to the INVITE sent to FreeSWITCH. */
      headers?: Record<string, string>;
    }

    interface ConnectCallerOptions {
      family?: Family;
      codecs?: string | string[];
      headers?: Record<string, string>;
    }

    // ─── Endpoint operation option/result shapes ────────────────────────

    interface PlaybackOptions {
      /** File (or `say:`/`tone_stream://`/`silence_stream://` URI) to play. */
      file: string;
      /** Seek offset, in samples, to start playback from. */
      seekOffset?: number;
      /** Auto-stop playback after this many seconds. */
      timeoutSecs?: number;
    }

    interface PlayResult {
      playbackSeconds?: string;
      playbackMilliseconds?: string;
      playbackLastOffsetPos?: string;
    }

    interface PlayCollectOptions {
      /** Prompt to play (file path or `say:`/stream URI). Required. */
      file: string;
      /** Minimum number of digits to collect. @default 0 */
      min?: number;
      /** Maximum number of digits to collect. @default 128 */
      max?: number;
      /** Number of attempts before returning failure. @default 1 */
      tries?: number;
      /** Total time (ms) to wait for digits after the prompt. @default 120000 */
      timeout?: number;
      /** Keys that terminate collection. @default '#' */
      terminators?: string;
      /** Prompt played on invalid input. @default 'silence_stream://250' */
      invalidFile?: string;
      /** FreeSWITCH variable used to buffer digits. @default 'myDigitBuffer' */
      varName?: string;
      /** Regexp digits must satisfy. @default '\\d+' */
      regexp?: string;
      /** Inter-digit timeout, in ms. @default 8000 */
      digitTimeout?: number;
    }

    interface PlayCollectResult {
      /** Digits collected (may be empty on timeout). */
      digits: string;
      invalidDigits?: string;
      terminatorUsed?: string;
      playbackSeconds?: string;
      playbackMilliseconds?: string;
    }

    type SayType =
      | 'number' | 'items' | 'persons' | 'messages' | 'currency'
      | 'time_measurement' | 'current_date' | 'current_time'
      | 'current_date_time' | 'telephone_number' | 'telephone_extension'
      | 'url' | 'ip_address' | 'email_address' | 'postal_address'
      | 'account_number' | 'name_spelled' | 'name_phonetic'
      | 'short_date_time';

    type SayMethod = 'pronounced' | 'iterated' | 'counted';
    type SayGender = 'feminine' | 'masculine' | 'neuter';

    interface SayOptions {
      sayType: SayType;
      sayMethod: SayMethod;
      /** @default 'en' */
      lang?: string;
      gender?: SayGender;
    }

    interface SpeakOptions {
      /** TTS engine name (e.g. 'flite'). */
      ttsEngine: string;
      /** TTS voice name (e.g. 'slt'). */
      voice: string;
      /** Text to speak. */
      text: string;
    }

    interface RecordOptions {
      /** Maximum recording duration, in seconds. */
      timeLimitSecs?: number;
      /** Energy level below which audio is treated as silence. */
      silenceThresh?: number;
      /** Consecutive silent packets after which recording stops. */
      silenceHits?: number;
    }

    interface RecordResult {
      terminatorUsed?: string;
      recordSeconds?: string;
      recordMilliseconds?: string;
      recordSamples?: string;
    }

    interface ConfJoinFlags {
      mute?: boolean;
      deaf?: boolean;
      muteDetect?: boolean;
      distDtmf?: boolean;
      moderator?: boolean;
      nomoh?: boolean;
      endconf?: boolean;
      mintwo?: boolean;
      ghost?: boolean;
      joinOnly?: boolean;
      positional?: boolean;
      noPositional?: boolean;
      joinVidFloor?: boolean;
      noMinimizeEncoding?: boolean;
      vmute?: boolean;
      secondScreen?: boolean;
      waitMod?: boolean;
      audioAlways?: boolean;
      videoBridgeFirstTwo?: boolean;
      videoMuxingPersonalCanvas?: boolean;
      videoRequiredForCanvas?: boolean;
    }

    interface ConfJoinOptions {
      pin?: string;
      /** @default 'default' */
      profile?: string;
      flags?: ConfJoinFlags;
    }

    interface ConfJoinResult {
      memberId: string;
      confUuid: string;
    }

    interface ConferenceCreateOptions {
      pin?: string;
      profile?: string;
      maxMembers?: number;
      flags?: ConfJoinFlags;
    }

    // ─── Event payloads ─────────────────────────────────────────────────

    interface DtmfEvent {
      dtmf: string;
      duration: string;
      source: string;
      ssrc?: string;
      timestamp?: string;
    }

    interface ToneEvent {
      tone: string;
    }

    interface PlaybackEvent {
      file?: string;
      [ttsVariable: string]: string | undefined;
    }

    interface ChannelEvent {
      uuid: string;
      countOfConnections: number;
      countOfChannels: number;
    }

    // ─── Endpoint network/SIP info ──────────────────────────────────────

    interface NetworkConnection {
      sdp?: string;
      mediaIp?: string;
      mediaPort?: string;
    }

    interface SipInfo {
      callId?: string;
    }

    interface ConfInfo {
      name?: string;
      memberId?: string;
      uuid?: string;
    }

    /**
     * Minimal shape of a drachtio-modesl ESL event, as returned by
     * `Endpoint#execute`. Only the accessors the library itself relies on
     * are surfaced.
     */
    interface EslEvent {
      getHeader(name: string): string | null;
      getBody(): string;
      getType(): string;
      serialize(format?: string): string;
    }

    // ─── MediaServer ────────────────────────────────────────────────────

    interface MediaServerSipAddress {
      address?: string;
      port?: number;
    }

    interface MediaServerSip {
      ipv4: { udp: MediaServerSipAddress; dtls: MediaServerSipAddress };
      ipv6: { udp: MediaServerSipAddress; dtls: MediaServerSipAddress };
    }

    class MediaServer extends EventEmitter {
      /** Maximum number of concurrent sessions allowed by FreeSWITCH. */
      maxSessions: number;
      /** Current active session count. */
      currentSessions: number;
      /** Calls per second. */
      cps: number;
      /** SIP listen addresses/ports per family/transport. */
      sip: MediaServerSip;

      // Populated from FreeSWITCH HEARTBEAT events:
      hostname?: string;
      v4address?: string;
      v6address?: string;
      fsVersion?: string;
      cpuIdle?: number;

      readonly address: string;
      readonly srf: Srf;

      /** True while the ESL connection is up. */
      connected(): boolean;

      /** True if FreeSWITCH advertises the given capability. */
      hasCapability(
        capability: 'dtls' | 'udp' | Array<'ipv4' | 'ipv6' | 'dtls' | 'udp'>,
      ): boolean;

      /**
       * Connect an inbound caller to the media server, producing an Endpoint
       * and SIP Dialog. Handles the DTLS-SRTP handshake automatically when the
       * caller's SDP requires it (browser/WebRTC).
       */
      connectCaller(
        req: Srf.SrfRequest,
        res: Srf.SrfResponse,
        opts?: ConnectCallerOptions,
      ): Promise<{ endpoint: Endpoint; dialog: Srf.Dialog }>;
      connectCaller(
        req: Srf.SrfRequest,
        res: Srf.SrfResponse,
        callback: (err: Error | null, pair: { endpoint: Endpoint; dialog: Srf.Dialog }) => void,
      ): MediaServer;
      connectCaller(
        req: Srf.SrfRequest,
        res: Srf.SrfResponse,
        opts: ConnectCallerOptions,
        callback: (err: Error | null, pair: { endpoint: Endpoint; dialog: Srf.Dialog }) => void,
      ): MediaServer;

      /** Allocate a (possibly inactive) endpoint not tied to an inbound call. */
      createEndpoint(opts?: EndpointOptions): Promise<Endpoint>;
      createEndpoint(
        opts: EndpointOptions,
        callback: (err: Error | null, ep: Endpoint) => void,
      ): MediaServer;

      /** Create a conference (without requiring an inbound call). */
      createConference(name?: string, opts?: ConferenceCreateOptions): Promise<Conference>;
      createConference(
        name: string,
        opts: ConferenceCreateOptions,
        callback: (err: Error | null, conf: Conference) => void,
      ): MediaServer;

      /** Send a raw FreeSWITCH API command. */
      api(command: string): Promise<string>;
      api(command: string, callback: (body: string) => void): MediaServer;

      /** Disconnect from the media server. */
      disconnect(): void;
      /** Alias for {@link disconnect}. */
      destroy(): void;

      on(event: 'connect' | 'ready', listener: () => void): this;
      on(event: 'error', listener: (err: Error) => void): this;
      on(event: 'end', listener: () => void): this;
      on(event: 'channel::open' | 'channel::close', listener: (evt: ChannelEvent) => void): this;
      on(event: string, listener: (...args: any[]) => void): this;
    }

    // ─── Endpoint ───────────────────────────────────────────────────────

    class Endpoint extends EventEmitter {
      /** FreeSWITCH channel UUID. */
      uuid: string;
      /** True if media is secure (DTLS-SRTP). */
      secure: boolean;
      local: NetworkConnection;
      remote: NetworkConnection;
      sip: SipInfo;
      conf: ConfInfo;
      dtmfType?: string;

      readonly mediaserver: MediaServer;
      readonly srf: Srf;
      readonly connected: boolean;
      readonly muted: boolean;
      dialog: Srf.Dialog;

      // Media operations ------------------------------------------------

      /** Play one or more files / stream URIs. */
      play(file: string | string[] | PlaybackOptions): Promise<PlayResult>;
      play(
        file: string | string[] | PlaybackOptions,
        callback: (err: Error | null, result: PlayResult) => void,
      ): Endpoint;

      /** Play a prompt and collect DTMF digits (`play_and_get_digits`). */
      playCollect(opts: PlayCollectOptions): Promise<PlayCollectResult>;
      playCollect(
        opts: PlayCollectOptions,
        callback: (err: Error | null, result: PlayCollectResult) => void,
      ): Endpoint;

      /** Speak a structured phrase (numbers, dates, etc.) via `say`. */
      say(text: string, opts: SayOptions): Promise<PlayResult>;
      say(
        text: string,
        opts: SayOptions,
        callback: (err: Error | null, result: PlayResult) => void,
      ): Endpoint;

      /** Speak free text via a TTS engine. */
      speak(opts: SpeakOptions): Promise<void>;
      speak(opts: SpeakOptions, callback: (err: Error | null) => void): Endpoint;

      /** Record the input stream to a file. */
      record(file: string, opts?: RecordOptions): Promise<RecordResult>;
      record(
        file: string,
        opts: RecordOptions,
        callback: (err: Error | null, result: RecordResult) => void,
      ): Endpoint;

      /** Record the full (bridged) session to a file. */
      recordSession(file: string): Promise<EslEvent>;
      recordSession(file: string, callback: (err: Error | null, evt: EslEvent) => void): Endpoint;

      // Routing / bridging ----------------------------------------------

      /** Join the endpoint into a conference. */
      join(conf: string | Conference, opts?: ConfJoinOptions): Promise<ConfJoinResult>;
      join(
        conf: string | Conference,
        opts: ConfJoinOptions,
        callback: (err: Error | null, result: ConfJoinResult) => void,
      ): Endpoint;

      /** Bridge this endpoint to another endpoint or channel uuid. */
      bridge(other: Endpoint | string): Promise<void>;
      bridge(other: Endpoint | string, callback: (err: Error | null) => void): Endpoint;

      /** Park the endpoint, breaking an existing bridge. */
      unbridge(): Promise<void>;
      unbridge(callback: (err: Error | null) => void): Endpoint;

      // Channel variables & raw control ---------------------------------

      /** Set a channel variable (or a map of variables). */
      set(param: string | Record<string, string>, value?: string): Promise<EslEvent>;
      set(
        param: string | Record<string, string>,
        value: string,
        callback: (err: Error | null, evt: EslEvent) => void,
      ): Endpoint;

      /** Export a channel variable (propagates across a bridge). */
      export(param: string | Record<string, string>, value?: string): Promise<EslEvent>;
      export(
        param: string | Record<string, string>,
        value: string,
        callback: (err: Error | null, evt: EslEvent) => void,
      ): Endpoint;

      /** Execute a FreeSWITCH dialplan application on the channel. */
      execute(app: string, arg?: string): Promise<EslEvent>;
      execute(app: string, arg: string, callback: (err: Error | null, evt: EslEvent) => void): Endpoint;
      execute(app: string, callback: (err: Error | null, evt: EslEvent) => void): Endpoint;

      /** Fire-and-forget application execution. */
      executeAsync(app: string, arg?: string, callback?: (evt: EslEvent) => void): void;

      /** Send a raw FreeSWITCH API command scoped to this channel. */
      api(command: string, args?: string | string[]): Promise<EslEvent>;
      api(command: string, callback: (err: Error | null, evt: EslEvent) => void): Endpoint;
      api(
        command: string,
        args: string | string[],
        callback: (err: Error | null, evt: EslEvent) => void,
      ): Endpoint;

      /** Re-negotiate media to a new SDP (or 'hold' / 'unhold'). */
      modify(newSdp: string): Promise<unknown>;

      /** Retrieve channel variables (optionally including RTP counters). */
      getChannelVariables(includeMedia?: boolean): Promise<Record<string, string>>;
      getChannelVariables(
        includeMedia: boolean,
        callback: (err: Error | null, vars: Record<string, string>) => void,
      ): Endpoint;

      /** Release the endpoint and hang up its channel. */
      destroy(): Promise<void>;
      destroy(callback: (err: Error | null) => void): Endpoint;

      // Conference member operations (only valid once joined) -----------
      confMute(): Promise<EslEvent>;
      confUnmute(): Promise<EslEvent>;
      confDeaf(): Promise<EslEvent>;
      confUndeaf(): Promise<EslEvent>;
      confKick(): Promise<EslEvent>;
      confHangup(): Promise<EslEvent>;
      /** Alias for {@link confKick}. */
      unjoin(): Promise<EslEvent>;

      // Custom event subscription ---------------------------------------
      addCustomEventListener(event: string, handler: (evt: EslEvent) => void): void;
      removeCustomEventListener(event: string, handler?: (evt: EslEvent) => void): void;
      resetEslCustomEvent(): void;

      toJSON(): { sip: SipInfo; local: NetworkConnection; remote: NetworkConnection; uuid: string };

      on(event: 'ready' | 'destroy', listener: () => void): this;
      on(event: 'dtmf', listener: (evt: DtmfEvent) => void): this;
      on(event: 'tone', listener: (evt: ToneEvent) => void): this;
      on(event: 'playback-start' | 'playback-stop', listener: (evt: PlaybackEvent) => void): this;
      on(event: 'error', listener: (err: Error) => void): this;
      on(event: string, listener: (...args: any[]) => void): this;
    }

    // ─── Conference ─────────────────────────────────────────────────────

    class Conference extends EventEmitter {
      name: string;
      uuid: string;
      /** File the conference is currently recording to, if any. */
      recordFile: string | null;
      locked: boolean;
      memberId: number;
      /** Current participants keyed by member id. */
      participants: Map<number, unknown>;
      /** Max members (-1 = unlimited). */
      maxMembers: number;

      readonly endpoint: Endpoint;
      readonly mediaserver: MediaServer;

      /** Destroy the conference, releasing all legs. */
      destroy(): Promise<void>;
      destroy(callback: (err: Error | null) => void): Conference;

      /** Play a file to the whole conference. */
      play(file: string | string[]): Promise<EslEvent>;
      play(file: string | string[], callback: (err: Error | null, evt: EslEvent) => void): Conference;

      /** Start/stop recording the conference mix. */
      startRecording(file: string): Promise<EslEvent>;
      stopRecording(file?: string): Promise<EslEvent>;

      /** Lock / unlock the conference. */
      lock(): Promise<EslEvent>;
      unlock(): Promise<EslEvent>;

      on(event: string, listener: (...args: any[]) => void): this;
    }
  }
}
