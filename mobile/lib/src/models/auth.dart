import 'dart:convert';

import '../config/app_config.dart';

/// SIP connection parameters delivered by the backend at login.
///
/// Mirrors the `sipConfig` object in the `/api/g/auth` response:
///   { wsUrl, sipWsUrl, domain, trunkEnabled }
class SipConfig {
  const SipConfig({
    required this.wsUrl,
    required this.sipWsUrl,
    required this.domain,
    required this.trunkEnabled,
  });

  /// Signalling WebSocket (presence / call events), e.g. ws://host:3002/signal.
  final String wsUrl;

  /// drachtio SIP-over-WebSocket transport, e.g. ws://host:5065.
  final String sipWsUrl;

  /// SIP realm / domain used for the AOR (sip:<ext>@<domain>).
  final String domain;

  final bool trunkEnabled;

  /// The SIP transport URL the client should actually dial, honouring the
  /// dev-only [AppConfig.sipWsUrlOverride].
  String get effectiveSipWsUrl =>
      AppConfig.sipWsUrlOverride.isNotEmpty ? AppConfig.sipWsUrlOverride : sipWsUrl;

  /// The realm the client should register against, honouring the override.
  String get effectiveDomain =>
      AppConfig.sipDomainOverride.isNotEmpty ? AppConfig.sipDomainOverride : domain;

  factory SipConfig.fromJson(Map<String, dynamic> json) => SipConfig(
        wsUrl: (json['wsUrl'] ?? '') as String,
        sipWsUrl: (json['sipWsUrl'] ?? '') as String,
        domain: (json['domain'] ?? '') as String,
        trunkEnabled: (json['trunkEnabled'] ?? false) as bool,
      );

  Map<String, dynamic> toJson() => {
        'wsUrl': wsUrl,
        'sipWsUrl': sipWsUrl,
        'domain': domain,
        'trunkEnabled': trunkEnabled,
      };
}

/// The authenticated user as returned under `data.user` / `/auth/me`.
class AppUser {
  const AppUser({
    required this.extension,
    required this.name,
    required this.username,
    required this.mobile,
    this.isAdmin = false,
  });

  final String extension;
  final String name;
  final String username;
  final String mobile;
  final bool isAdmin;

  factory AppUser.fromJson(Map<String, dynamic> json) => AppUser(
        extension: (json['extension'] ?? '') as String,
        name: (json['name'] ?? '') as String,
        username: (json['username'] ?? '') as String,
        mobile: (json['mobile'] ?? '') as String,
        isAdmin: (json['isAdmin'] ?? false) as bool,
      );

  Map<String, dynamic> toJson() => {
        'extension': extension,
        'name': name,
        'username': username,
        'mobile': mobile,
        'isAdmin': isAdmin,
      };
}

/// Full successful-login payload (`data` from the auth envelope).
class AuthResult {
  const AuthResult({
    required this.token,
    required this.refreshToken,
    required this.expiresIn,
    required this.user,
    required this.sipConfig,
  });

  final String token;
  final String refreshToken;
  final int expiresIn;
  final AppUser user;
  final SipConfig sipConfig;

  factory AuthResult.fromJson(Map<String, dynamic> json) => AuthResult(
        token: (json['token'] ?? '') as String,
        refreshToken: (json['refreshToken'] ?? '') as String,
        expiresIn: (json['expiresIn'] ?? 0) as int,
        user: AppUser.fromJson((json['user'] ?? const {}) as Map<String, dynamic>),
        sipConfig:
            SipConfig.fromJson((json['sipConfig'] ?? const {}) as Map<String, dynamic>),
      );

  String encode() => jsonEncode({
        'token': token,
        'refreshToken': refreshToken,
        'expiresIn': expiresIn,
        'user': user.toJson(),
        'sipConfig': sipConfig.toJson(),
      });

  static AuthResult decode(String raw) =>
      AuthResult.fromJson(jsonDecode(raw) as Map<String, dynamic>);
}
