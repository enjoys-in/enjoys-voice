import 'dart:async';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_callkit_incoming/entities/entities.dart';
import 'package:flutter_callkit_incoming/flutter_callkit_incoming.dart';
import 'package:uuid/uuid.dart';

/// Bridges to the native incoming-call UI: CallKit on iOS and a
/// full-screen ConnectionService notification on Android. This is what makes
/// the phone ring on the lock screen / when the app is backgrounded.
class CallKitService {
  CallKitService() {
    // The native plugin only exists on Android/iOS; skip the event channel on
    // web/desktop so the UI can still run for previews.
    if (!kIsWeb) {
      _subscription = FlutterCallkitIncoming.onEvent.listen(_handleEvent);
    }
  }

  StreamSubscription<CallEvent?>? _subscription;

  /// User accepted the native call. Argument is the CallKit call id.
  void Function(String callId, Map<String, dynamic> extra)? onAccept;

  /// User declined / ended the native call.
  void Function(String callId)? onDecline;

  /// Native call ended (after answer, hung up from the system UI).
  void Function(String callId)? onEnded;

  void _handleEvent(CallEvent? event) {
    if (event == null) return;
    final body = event.body;
    final id = (body['id'] ?? '') as String;
    final extra = (body['extra'] as Map?)?.cast<String, dynamic>() ?? const {};
    switch (event.event) {
      case Event.actionCallAccept:
        onAccept?.call(id, extra);
        break;
      case Event.actionCallDecline:
      case Event.actionCallTimeout:
        onDecline?.call(id);
        break;
      case Event.actionCallEnded:
        onEnded?.call(id);
        break;
      default:
        break;
    }
  }

  /// Show a native incoming-call screen. Returns the CallKit call id.
  Future<String> showIncoming({
    required String callId,
    required String callerName,
    required String callerNumber,
    Map<String, dynamic> extra = const {},
  }) async {
    final id = callId.isNotEmpty ? callId : const Uuid().v4();
    if (kIsWeb) return id; // No native CallKit on web.
    final params = CallKitParams(
      id: id,
      nameCaller: callerName.isNotEmpty ? callerName : callerNumber,
      appName: 'Enjoys Voice',
      handle: callerNumber,
      type: 0, // 0 = audio, 1 = video
      textAccept: 'Accept',
      textDecline: 'Decline',
      duration: 45000,
      extra: <String, dynamic>{...extra, 'number': callerNumber},
      missedCallNotification: const NotificationParams(
        showNotification: true,
        isShowCallback: false,
        subtitle: 'Missed call',
      ),
      android: const AndroidParams(
        isCustomNotification: true,
        isShowLogo: false,
        ringtonePath: 'system_ringtone_default',
        backgroundColor: '#0a2540',
        actionColor: '#22c55e',
        textColor: '#ffffff',
        isShowFullLockedScreen: true,
      ),
      ios: const IOSParams(
        handleType: 'generic',
        supportsVideo: false,
        maximumCallGroups: 1,
        maximumCallsPerCallGroup: 1,
        audioSessionMode: 'voiceChat',
        supportsDTMF: true,
        supportsHolding: true,
      ),
    );
    await FlutterCallkitIncoming.showCallkitIncoming(params);
    return id;
  }

  /// Promote a CallKit entry to the "connected" state (after SIP answers).
  Future<void> setConnected(String callId) async {
    if (kIsWeb) return;
    await FlutterCallkitIncoming.setCallConnected(callId);
  }

  Future<void> endCall(String callId) async {
    if (kIsWeb) return;
    if (callId.isEmpty) {
      await FlutterCallkitIncoming.endAllCalls();
      return;
    }
    await FlutterCallkitIncoming.endCall(callId);
  }

  Future<void> endAll() async {
    if (kIsWeb) return;
    await FlutterCallkitIncoming.endAllCalls();
  }

  void dispose() {
    _subscription?.cancel();
  }
}
