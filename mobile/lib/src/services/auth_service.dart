import '../models/auth.dart';
import 'api_client.dart';
import 'token_store.dart';

/// Auth operations against the Go API (`/api/g/auth/*`) plus session persistence.
class AuthService {
  AuthService(this._api, this._tokens);

  final ApiClient _api;
  final TokenStore _tokens;

  /// Username + password login. Persists the session on success.
  Future<AuthResult> login(String username, String password) async {
    final data = await _api.postPublic('/auth', {
      'username': username.trim(),
      'password': password,
    });
    final result = AuthResult.fromJson(data as Map<String, dynamic>);
    await _tokens.save(result);
    return result;
  }

  /// Self-service signup: name + mobile + password.
  Future<AuthResult> signup({
    required String name,
    required String mobile,
    required String password,
  }) async {
    final data = await _api.postPublic('/auth/signup', {
      'name': name.trim(),
      'mobile': mobile.trim(),
      'password': password,
    });
    final result = AuthResult.fromJson(data as Map<String, dynamic>);
    await _tokens.save(result);
    return result;
  }

  /// Returns the cached session if a token is still present, else null.
  Future<AuthResult?> restore() => _tokens.readSession();

  /// Validates the current token and refreshes the cached user/sip config.
  Future<AppUser?> me() async {
    final data = await _api.get('/auth/me');
    if (data is Map<String, dynamic>) {
      return AppUser.fromJson(data);
    }
    return null;
  }

  Future<void> logout() async {
    try {
      await _api.post('/auth/logout', const {});
    } catch (_) {
      // Best-effort; clear locally regardless.
    }
    await _tokens.clear();
  }
}
