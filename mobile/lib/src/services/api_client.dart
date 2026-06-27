import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/app_config.dart';
import 'token_store.dart';

/// Thrown for non-2xx responses so callers can show the backend message.
class ApiException implements Exception {
  ApiException(this.statusCode, this.message);
  final int statusCode;
  final String message;
  @override
  String toString() => 'ApiException($statusCode): $message';
}

/// Thin REST client for the Go API.
///
/// * Prefixes every path with `<GO_API_BASE>/api/g`.
/// * Unwraps the `{ success, message, data }` envelope and returns `data`.
/// * Attaches `Authorization: Bearer <token>` from [TokenStore] when present.
/// * On a 401 it transparently calls `/auth/refresh` once and retries.
class ApiClient {
  ApiClient(this._tokens, {http.Client? client})
      : _http = client ?? http.Client();

  final TokenStore _tokens;
  final http.Client _http;

  Uri _uri(String path) => Uri.parse('${AppConfig.authBase}$path');

  Future<Map<String, String>> _headers({bool auth = true}) async {
    final h = <String, String>{'Content-Type': 'application/json'};
    if (auth) {
      final token = await _tokens.readToken();
      if (token != null && token.isNotEmpty) {
        h['Authorization'] = 'Bearer $token';
      }
    }
    return h;
  }

  /// POST that does NOT require / refresh auth (login, signup, refresh).
  Future<dynamic> postPublic(String path, Map<String, dynamic> body) async {
    final res = await _http.post(
      _uri(path),
      headers: await _headers(auth: false),
      body: jsonEncode(body),
    );
    return _unwrap(res);
  }

  Future<dynamic> post(String path, Map<String, dynamic> body) =>
      _authed(() async => _http.post(
            _uri(path),
            headers: await _headers(),
            body: jsonEncode(body),
          ));

  /// Authenticated POST against the Node engine API (`<NODE_API_BASE>/api/n`).
  Future<dynamic> postNode(String path, Map<String, dynamic> body) =>
      _authed(() async => _http.post(
            Uri.parse('${AppConfig.nodeBase}$path'),
            headers: await _headers(),
            body: jsonEncode(body),
          ));

  Future<dynamic> get(String path) =>
      _authed(() async => _http.get(_uri(path), headers: await _headers()));

  Future<dynamic> patch(String path, Map<String, dynamic> body) =>
      _authed(() async => _http.patch(
            _uri(path),
            headers: await _headers(),
            body: jsonEncode(body),
          ));

  /// Runs an authenticated request, retrying once after a token refresh on 401.
  Future<dynamic> _authed(Future<http.Response> Function() send) async {
    var res = await send();
    if (res.statusCode == 401 && await _tryRefresh()) {
      res = await send();
    }
    return _unwrap(res);
  }

  bool _refreshing = false;

  Future<bool> _tryRefresh() async {
    if (_refreshing) return false;
    _refreshing = true;
    try {
      final refreshToken = await _tokens.readRefreshToken();
      if (refreshToken == null || refreshToken.isEmpty) return false;
      final res = await _http.post(
        _uri('/auth/refresh'),
        headers: const {'Content-Type': 'application/json'},
        body: jsonEncode({'refreshToken': refreshToken}),
      );
      if (res.statusCode < 200 || res.statusCode >= 300) return false;
      final data = _extractData(res.body);
      if (data is Map<String, dynamic>) {
        await _tokens.updateTokens(
          token: (data['token'] ?? '') as String,
          refreshToken: (data['refreshToken'] ?? refreshToken) as String,
        );
        return true;
      }
      return false;
    } catch (_) {
      return false;
    } finally {
      _refreshing = false;
    }
  }

  dynamic _unwrap(http.Response res) {
    final data = _extractData(res.body);
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw ApiException(res.statusCode, _messageOf(res.body, res.statusCode));
    }
    return data;
  }

  /// Returns the `data` field of the envelope, or the raw decoded body when the
  /// response isn't wrapped.
  dynamic _extractData(String body) {
    if (body.isEmpty) return null;
    final decoded = jsonDecode(body);
    if (decoded is Map<String, dynamic> && decoded.containsKey('data')) {
      return decoded['data'];
    }
    return decoded;
  }

  String _messageOf(String body, int status) {
    try {
      final decoded = jsonDecode(body);
      if (decoded is Map<String, dynamic>) {
        final m = decoded['message'] ?? decoded['error'];
        if (m is String && m.isNotEmpty) return m;
      }
    } catch (_) {}
    return 'Request failed ($status)';
  }

  void dispose() => _http.close();
}
