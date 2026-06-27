import 'package:flutter/foundation.dart';

import '../models/auth.dart';
import '../services/auth_service.dart';
import '../services/callkit_service.dart';
import '../services/phone_service.dart';
import '../services/push_service.dart';

enum AuthStatus { unknown, loggedOut, loggedIn }

/// Top-level orchestration: authentication lifecycle plus the wiring that ties
/// SIP calls to the native CallKit UI and push wake-ups together.
class SessionController extends ChangeNotifier {
  SessionController({
    required AuthService auth,
    required PhoneService phone,
    required CallKitService callkit,
    required PushService push,
  })  : _auth = auth,
        _phone = phone,
        _callkit = callkit,
        _push = push {
    _wire();
  }

  final AuthService _auth;
  final PhoneService _phone;
  final CallKitService _callkit;
  final PushService _push;

  AuthStatus status = AuthStatus.unknown;
  AppUser? user;
  String? errorMessage;
  bool busy = false;

  /// Set when CallKit is accepted before the SIP INVITE has arrived (push-first
  /// flow): we auto-answer as soon as the matching call is offered.
  bool _pendingAccept = false;

  PhoneService get phone => _phone;

  void _wire() {
    // SIP → CallKit
    _phone.onIncomingCall = (call) async {
      final id = await _callkit.showIncoming(
        callId: call.id,
        callerName: call.displayName,
        callerNumber: call.peer,
        extra: {'callId': call.id, 'number': call.peer},
      );
      // If the user already accepted via a push-driven CallKit screen, answer.
      if (_pendingAccept) {
        _pendingAccept = false;
        await _phone.answer();
        await _callkit.setConnected(id);
      }
    };
    _phone.onCallConnected = (call) async {
      await _callkit.setConnected(call.id);
    };
    _phone.onCallEnded = (call) async {
      await _callkit.endCall(call.id);
    };

    // CallKit → SIP
    _callkit.onAccept = (id, extra) async {
      if (_phone.hasActiveCall) {
        await _phone.answer();
        await _callkit.setConnected(id);
      } else {
        // Push arrived first; remember to answer when the INVITE lands.
        _pendingAccept = true;
      }
    };
    _callkit.onDecline = (id) async {
      _pendingAccept = false;
      await _phone.hangup();
    };
    _callkit.onEnded = (id) async {
      await _phone.hangup();
    };

    // Foreground push → CallKit (the SIP INVITE follows over the wire)
    _push.onIncomingPush = (data) async {
      await _callkit.showIncoming(
        callId: (data['callId'] ?? '') as String,
        callerName: (data['fromName'] ?? data['from'] ?? 'Unknown') as String,
        callerNumber: (data['from'] ?? 'Unknown') as String,
        extra: Map<String, dynamic>.from(data),
      );
    };
  }

  /// Restore a saved session on app start.
  Future<void> bootstrap() async {
    final session = await _auth.restore();
    if (session == null) {
      _setStatus(AuthStatus.loggedOut);
      return;
    }
    user = session.user;
    _setStatus(AuthStatus.loggedIn);
    await _afterLogin(session);
  }

  Future<bool> login(String username, String password) async {
    _setBusy(true);
    errorMessage = null;
    try {
      final result = await _auth.login(username, password);
      user = result.user;
      _setStatus(AuthStatus.loggedIn);
      await _afterLogin(result);
      return true;
    } catch (e) {
      errorMessage = _humanError(e);
      notifyListeners();
      return false;
    } finally {
      _setBusy(false);
    }
  }

  Future<bool> signup({
    required String name,
    required String mobile,
    required String password,
  }) async {
    _setBusy(true);
    errorMessage = null;
    try {
      final result = await _auth.signup(name: name, mobile: mobile, password: password);
      user = result.user;
      _setStatus(AuthStatus.loggedIn);
      await _afterLogin(result);
      return true;
    } catch (e) {
      errorMessage = _humanError(e);
      notifyListeners();
      return false;
    } finally {
      _setBusy(false);
    }
  }

  Future<void> logout() async {
    try {
      await _push.unregister();
    } catch (_) {}
    await _phone.unregister();
    await _callkit.endAll();
    await _auth.logout();
    user = null;
    _setStatus(AuthStatus.loggedOut);
  }

  Future<void> _afterLogin(AuthResult result) async {
    await _phone.register(result.sipConfig, result.user);
    try {
      await _push.registerWithBackend();
    } catch (_) {}
  }

  String _humanError(Object e) {
    final s = e.toString();
    return s.replaceFirst('ApiException', 'Error').replaceFirst(RegExp(r'^Exception: '), '');
  }

  void _setStatus(AuthStatus s) {
    status = s;
    notifyListeners();
  }

  void _setBusy(bool b) {
    busy = b;
    notifyListeners();
  }
}
