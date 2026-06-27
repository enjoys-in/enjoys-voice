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
  /// Defaults to the Android-emulator host alias (`10.0.2.2` == the dev
  /// machine's `localhost`). Override for real devices / iOS simulator.
  static const String goApiBase = String.fromEnvironment(
    'GO_API_BASE',
    defaultValue: 'http://10.0.2.2:3003',
  );

  /// Convenience: the `/api/g` prefix that every auth route hangs off.
  static String get authBase => '$goApiBase/api/g';

  /// Base URL of the Node SIP engine REST API (push registration lives under
  /// `<base>/api/n`). Dev default is the emulator host alias on port 3001;
  /// in prod this is usually the same origin as [goApiBase] behind a proxy.
  static const String nodeApiBase = String.fromEnvironment(
    'NODE_API_BASE',
    defaultValue: 'http://10.0.2.2:3001',
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

  /// Fallback ICE servers (Google STUN + the dev TURN). Replace the TURN
  /// credentials for production via `--dart-define=ICE_SERVERS=...`.
  static const List<Map<String, dynamic>> defaultIceServers = [
    {'urls': 'stun:stun.l.google.com:19302'},
    {
      'urls': 'turn:192.168.1.48:3478',
      'username': 'callnet',
      'credential': 'devsecret123',
    },
  ];
}
