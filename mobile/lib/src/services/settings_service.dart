import 'package:flutter/foundation.dart';

import 'api_client.dart';

/// Loads and persists the signed-in user's preferences, mirroring the web
/// Settings screen. Backed by the Go API (`/api/g`):
///   * GET/PUT  `/settings/<ext>`     – toggles (DND, sounds, DTMF, recording,
///     voicemail) and the PSTN fallback fields (enable + mobile + country code)
///   * GET/POST `/forwarding/<ext>`   – busy / noAnswer / unavailable targets
///   * GET/POST/DELETE `/block/<ext>` – blocked numbers
///
/// All mutations are optimistic: local state updates immediately and reverts if
/// the request fails (mirrors the web client's behaviour).
class SettingsService extends ChangeNotifier {
  SettingsService(this._api);

  final ApiClient _api;

  String? _ext;
  bool _loaded = false;
  bool loading = false;

  // ── /settings flat toggles ──────────────────────────────────────────────
  bool soundsEnabled = true;
  bool dtmfEnabled = true;
  bool recordingEnabled = false;
  bool voicemailEnabled = false;
  bool dnd = false;

  // ── PSTN fallback (Browser → Phone) ─────────────────────────────────────
  bool pstnEnabled = false;
  String pstnMobile = '';
  String pstnCountryCode = '+91';

  // ── Call forwarding targets (empty == disabled) ─────────────────────────
  String forwardBusy = '';
  String forwardNoAnswer = '';
  String forwardUnavailable = '';

  // ── Blocked numbers ─────────────────────────────────────────────────────
  List<String> blockedNumbers = const [];

  bool get isLoaded => _loaded;

  /// Fetch all settings for [ext] once. Pass [force] to refetch (e.g. after a
  /// different user signs in).
  Future<void> load(String ext, {bool force = false}) async {
    if (ext.isEmpty) return;
    if (_ext == ext && _loaded && !force) return;
    _ext = ext;
    loading = true;
    notifyListeners();
    try {
      final enc = Uri.encodeComponent(ext);
      final results = await Future.wait<dynamic>([
        _api.get('/settings/$enc').catchError((_) => null),
        _api.get('/forwarding/$enc').catchError((_) => null),
        _api.get('/block/$enc').catchError((_) => null),
      ]);

      final s = results[0];
      if (s is Map<String, dynamic>) {
        soundsEnabled = s['sounds_enabled'] as bool? ?? soundsEnabled;
        dtmfEnabled = s['dtmf_enabled'] as bool? ?? dtmfEnabled;
        recordingEnabled = s['recording_enabled'] as bool? ?? recordingEnabled;
        voicemailEnabled = s['voicemail_enabled'] as bool? ?? voicemailEnabled;
        dnd = s['dnd'] as bool? ?? dnd;
        pstnEnabled = s['pstn_enabled'] as bool? ?? pstnEnabled;
        pstnMobile = s['pstn_mobile'] as String? ?? pstnMobile;
        final cc = s['pstn_country_code'] as String? ?? '';
        if (cc.isNotEmpty) pstnCountryCode = cc;
      }

      final f = results[1];
      if (f is Map<String, dynamic>) {
        forwardBusy = (f['busy'] as String?) ?? '';
        forwardNoAnswer = (f['noAnswer'] as String?) ?? '';
        forwardUnavailable = (f['unavailable'] as String?) ?? '';
      }

      final b = results[2];
      if (b is Map<String, dynamic> && b['blocked'] is List) {
        blockedNumbers =
            (b['blocked'] as List).whereType<String>().toList(growable: false);
      }

      _loaded = true;
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  /// Drop loaded state (e.g. on sign-out) so the next user reloads fresh.
  void reset() {
    _ext = null;
    _loaded = false;
    loading = false;
    soundsEnabled = true;
    dtmfEnabled = true;
    recordingEnabled = false;
    voicemailEnabled = false;
    dnd = false;
    pstnEnabled = false;
    pstnMobile = '';
    pstnCountryCode = '+91';
    forwardBusy = '';
    forwardNoAnswer = '';
    forwardUnavailable = '';
    blockedNumbers = const [];
    notifyListeners();
  }

  // ── Mutations ───────────────────────────────────────────────────────────

  Future<void> setDnd(bool value) =>
      _toggle(() => dnd, (v) => dnd = v, value, {'dnd': value});

  Future<void> setSoundsEnabled(bool value) => _toggle(
      () => soundsEnabled, (v) => soundsEnabled = v, value, {'sounds_enabled': value});

  Future<void> setDtmfEnabled(bool value) => _toggle(
      () => dtmfEnabled, (v) => dtmfEnabled = v, value, {'dtmf_enabled': value});

  Future<void> setRecordingEnabled(bool value) => _toggle(() => recordingEnabled,
      (v) => recordingEnabled = v, value, {'recording_enabled': value});

  Future<void> setVoicemailEnabled(bool value) => _toggle(() => voicemailEnabled,
      (v) => voicemailEnabled = v, value, {'voicemail_enabled': value});

  /// Persist the PSTN fallback (Browser → Phone) settings together.
  Future<void> savePstn({
    required bool enabled,
    required String mobile,
    required String countryCode,
  }) async {
    final prevEnabled = pstnEnabled;
    final prevMobile = pstnMobile;
    final prevCc = pstnCountryCode;
    pstnEnabled = enabled;
    pstnMobile = mobile;
    pstnCountryCode = countryCode.isEmpty ? '+91' : countryCode;
    notifyListeners();
    try {
      await _putSettings({
        'pstn_enabled': enabled,
        'pstn_mobile': mobile,
        'pstn_country_code': pstnCountryCode,
      });
    } catch (_) {
      pstnEnabled = prevEnabled;
      pstnMobile = prevMobile;
      pstnCountryCode = prevCc;
      notifyListeners();
      rethrow;
    }
  }

  /// Set a forwarding target. [type] is `busy`, `noAnswer` or `unavailable`;
  /// an empty [target] clears the rule.
  Future<void> setForwarding(String type, String target) async {
    final prevBusy = forwardBusy;
    final prevNoAnswer = forwardNoAnswer;
    final prevUnavail = forwardUnavailable;
    switch (type) {
      case 'busy':
        forwardBusy = target;
        break;
      case 'noAnswer':
        forwardNoAnswer = target;
        break;
      case 'unavailable':
        forwardUnavailable = target;
        break;
    }
    notifyListeners();
    try {
      await _post('/forwarding', {'type': type, 'target': target});
    } catch (_) {
      forwardBusy = prevBusy;
      forwardNoAnswer = prevNoAnswer;
      forwardUnavailable = prevUnavail;
      notifyListeners();
      rethrow;
    }
  }

  Future<void> blockNumber(String number) async {
    final n = number.trim();
    if (n.isEmpty || blockedNumbers.contains(n)) return;
    final prev = blockedNumbers;
    blockedNumbers = [...blockedNumbers, n];
    notifyListeners();
    try {
      await _post('/block', {'number': n});
    } catch (_) {
      blockedNumbers = prev;
      notifyListeners();
      rethrow;
    }
  }

  Future<void> unblockNumber(String number) async {
    final ext = _ext;
    if (ext == null) return;
    final prev = blockedNumbers;
    blockedNumbers = blockedNumbers.where((n) => n != number).toList(growable: false);
    notifyListeners();
    try {
      await _api.delete(
        '/block/${Uri.encodeComponent(ext)}/${Uri.encodeComponent(number)}',
      );
    } catch (_) {
      blockedNumbers = prev;
      notifyListeners();
      rethrow;
    }
  }

  // ── Internals ───────────────────────────────────────────────────────────

  Future<void> _toggle(
    bool Function() get,
    void Function(bool) set,
    bool value,
    Map<String, dynamic> body,
  ) async {
    final prev = get();
    set(value);
    notifyListeners();
    try {
      await _putSettings(body);
    } catch (_) {
      set(prev);
      notifyListeners();
      rethrow;
    }
  }

  Future<void> _putSettings(Map<String, dynamic> body) async {
    final ext = _ext;
    if (ext == null) return;
    await _api.put('/settings/${Uri.encodeComponent(ext)}', body);
  }

  Future<void> _post(String base, Map<String, dynamic> body) async {
    final ext = _ext;
    if (ext == null) return;
    await _api.post('$base/${Uri.encodeComponent(ext)}', body);
  }
}
