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

  /// Request an SMS one-time code. `purpose` is 'login' or 'signup'. The backend
  /// always reports success (it never reveals whether a number is registered).
  Future<void> requestOtp(String mobile, String purpose) async {
    await _api.postPublic('/auth/otp/request', {
      'mobile': mobile.trim(),
      'purpose': purpose,
    });
  }

  /// Passwordless login with the SMS code. Persists the session on success.
  Future<AuthResult> loginOtp(String mobile, String code) async {
    final data = await _api.postPublic('/auth/login/otp', {
      'mobile': mobile.trim(),
      'code': code.trim(),
    });
    final result = AuthResult.fromJson(data as Map<String, dynamic>);
    await _tokens.save(result);
    return result;
  }

  /// Complete mobile-verified signup with the SMS code.
  Future<AuthResult> signupVerify({
    required String name,
    required String mobile,
    required String password,
    required String code,
  }) async {
    final data = await _api.postPublic('/auth/signup/verify', {
      'name': name.trim(),
      'mobile': mobile.trim(),
      'password': password,
      'code': code.trim(),
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
