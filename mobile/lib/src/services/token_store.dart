import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../models/auth.dart';

/// Persists the JWT/refresh token + cached session in the platform keystore.
class TokenStore {
  TokenStore([FlutterSecureStorage? storage])
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
            );

  final FlutterSecureStorage _storage;

  static const _kToken = 'auth_token';
  static const _kRefresh = 'refresh_token';
  static const _kSession = 'auth_session'; // full AuthResult JSON

  Future<void> save(AuthResult result) async {
    await _storage.write(key: _kToken, value: result.token);
    await _storage.write(key: _kRefresh, value: result.refreshToken);
    await _storage.write(key: _kSession, value: result.encode());
  }

  Future<void> updateTokens({
    required String token,
    required String refreshToken,
  }) async {
    await _storage.write(key: _kToken, value: token);
    await _storage.write(key: _kRefresh, value: refreshToken);
    // Keep the cached session's tokens in sync.
    final session = await readSession();
    if (session != null) {
      final refreshed = AuthResult(
        token: token,
        refreshToken: refreshToken,
        expiresIn: session.expiresIn,
        user: session.user,
        sipConfig: session.sipConfig,
      );
      await _storage.write(key: _kSession, value: refreshed.encode());
    }
  }

  Future<String?> readToken() => _storage.read(key: _kToken);

  Future<String?> readRefreshToken() => _storage.read(key: _kRefresh);

  Future<AuthResult?> readSession() async {
    final raw = await _storage.read(key: _kSession);
    if (raw == null || raw.isEmpty) return null;
    try {
      return AuthResult.decode(raw);
    } catch (_) {
      return null;
    }
  }

  Future<void> clear() async {
    await _storage.delete(key: _kToken);
    await _storage.delete(key: _kRefresh);
    await _storage.delete(key: _kSession);
  }
}
