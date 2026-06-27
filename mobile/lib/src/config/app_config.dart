/// Static app configuration, overridable at build time with `--dart-define`.
///
/// Example (real device on a LAN where the backend host is 192.168.1.48):
///   flutter run \
///     --dart-define=GO_API_BASE=http://192.168.1.48:3003 \
///     --dart-define=SIP_WS_URL_OVERRIDE=ws://192.168.1.48:5065 \
///     --dart-define=SIP_DOMAIN_OVERRIDE=192.168.1.48
class AppConfig {
  AppConfig._();

  /// Base URL of the Go REST API. All auth lives under `<base>/api/g`.
  ///
  /// Defaults to the production host (TLS, behind Caddy). For local dev
  /// override with `--dart-define=GO_API_BASE=http://10.0.2.2:3003` (the
  /// Android-emulator host alias) or your LAN IP for a real device.
  static const String goApiBase = String.fromEnvironment(
    'GO_API_BASE',
    defaultValue: 'https://voice.enjoys.in',
  );

  /// Convenience: the `/api/g` prefix that every auth route hangs off.
  static String get authBase => '$goApiBase/api/g';

  /// Base URL of the Node SIP engine REST API (push registration lives under
  /// `<base>/api/n`). In prod this is the same origin as [goApiBase] behind
  /// Caddy. For local dev override with
  /// `--dart-define=NODE_API_BASE=http://10.0.2.2:3001`.
  static const String nodeApiBase = String.fromEnvironment(
    'NODE_API_BASE',
    defaultValue: 'https://voice.enjoys.in',
  );

  /// The `/api/n` prefix for the Node engine routes.
  static String get nodeBase => '$nodeApiBase/api/n';

  /// In dev the backend often advertises a `sipWsUrl` of `127.0.0.1`/`localhost`
  /// in the login response, which is unreachable from a phone. Setting this
  /// override forces the SIP transport to a reachable host. Leave empty in prod
  /// (the value from `sipConfig.sipWsUrl` is used as-is).
  static const String sipWsUrlOverride = String.fromEnvironment(
    'SIP_WS_URL_OVERRIDE',
    defaultValue: '',
  );

  /// Optional SIP realm/domain override (same dev rationale as above).
  static const String sipDomainOverride = String.fromEnvironment(
    'SIP_DOMAIN_OVERRIDE',
    defaultValue: '',
  );

  /// ICE servers as a JSON array string, e.g.
  ///   --dart-define=ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"}]
  /// When empty the [defaultIceServers] below are used.
  static const String iceServersJson = String.fromEnvironment(
    'ICE_SERVERS',
    defaultValue: '',
  );

  /// Fallback ICE servers: Google STUN + the production coturn TURN relay
  /// (voice.enjoys.in == 77.237.241.24) needed for reliable two-way audio
  /// through NAT. Override with `--dart-define=ICE_SERVERS=[...]` if needed.
  static const List<Map<String, dynamic>> defaultIceServers = [
    {'urls': 'stun:stun.l.google.com:19302'},
    {
      'urls': 'turn:77.237.241.24:3478?transport=udp',
      'username': 'callnet',
      'credential': 'devsecret123',
    },
  ];
}
