import 'dart:io' show Platform;

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_callkit_incoming/entities/entities.dart';
import 'package:flutter_callkit_incoming/flutter_callkit_incoming.dart';

import 'api_client.dart';

/// Background FCM handler. Must be a top-level / static function annotated with
/// `@pragma('vm:entry-point')` so it survives tree-shaking and can run in the
/// background isolate. Shows the native incoming-call UI straight from the push
/// payload, before the app (and SIP) are even running.
@pragma('vm:entry-point')
Future<void> firebaseBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
  final data = message.data;
  if (data['type'] != 'incoming_call') return;
  await _showIncomingFromData(data);
}

Future<void> _showIncomingFromData(Map<String, dynamic> data) async {
  final callId = (data['callId'] ?? '') as String;
  final from = (data['from'] ?? 'Unknown') as String;
  final fromName = (data['fromName'] ?? from) as String;
  final params = CallKitParams(
    id: callId.isNotEmpty ? callId : from,
    nameCaller: fromName,
    appName: 'Enjoys Voice',
    handle: from,
    type: 0,
    duration: 45000,
    textAccept: 'Accept',
    textDecline: 'Decline',
    extra: <String, dynamic>{'number': from, 'callId': callId},
    android: const AndroidParams(
      isCustomNotification: true,
      ringtonePath: 'system_ringtone_default',
      backgroundColor: '#0a2540',
      actionColor: '#22c55e',
      isShowFullLockedScreen: true,
    ),
    ios: const IOSParams(handleType: 'generic', supportsVideo: false),
  );
  await FlutterCallkitIncoming.showCallkitIncoming(params);
}

/// Registers the device for push wake-ups and forwards incoming-call pushes to
/// CallKit when the app is in the foreground.
class PushService {
  PushService(this._api);

  final ApiClient _api;
  final FirebaseMessaging _fm = FirebaseMessaging.instance;

  /// Called for a foreground `incoming_call` data message (so we can also show
  /// CallKit / navigate when the app is already open).
  void Function(Map<String, dynamic> data)? onIncomingPush;

  /// Initialise Firebase, request permission, register the token, wire handlers.
  Future<void> init() async {
    await Firebase.initializeApp();
    FirebaseMessaging.onBackgroundMessage(firebaseBackgroundHandler);

    await _fm.requestPermission(alert: true, badge: true, sound: true);

    FirebaseMessaging.onMessage.listen((msg) {
      if (msg.data['type'] == 'incoming_call') {
        onIncomingPush?.call(msg.data);
      }
    });

    _fm.onTokenRefresh.listen(_sendFcmToken);
  }

  /// Push the current FCM token (Android) and VoIP token (iOS) to the backend.
  /// Call this once the user is authenticated.
  Future<void> registerWithBackend() async {
    try {
      final fcmToken = await _fm.getToken();
      if (fcmToken != null) await _sendFcmToken(fcmToken);

      if (Platform.isIOS) {
        // iOS background calls require an APNs VoIP (PushKit) token, surfaced by
        // flutter_callkit_incoming. Register it so the backend can target it.
        final voip = await FlutterCallkitIncoming.getDevicePushTokenVoIP();
        if (voip is String && voip.isNotEmpty) {
          await _send(token: voip, platform: 'ios_voip');
        }
      }
    } catch (e) {
      debugPrint('PushService.registerWithBackend failed: $e');
    }
  }

  Future<void> _sendFcmToken(String token) =>
      _send(token: token, platform: Platform.isIOS ? 'ios' : 'android');

  Future<void> _send({required String token, required String platform}) async {
    await _api.postNode('/push/register', {
      'token': token,
      'platform': platform,
    });
  }

  /// Remove this device's tokens on logout.
  Future<void> unregister() async {
    try {
      final fcmToken = await _fm.getToken();
      if (fcmToken != null) {
        await _api.postNode('/push/unregister', {'token': fcmToken});
      }
    } catch (_) {}
  }
}
