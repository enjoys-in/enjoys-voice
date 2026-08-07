// iOS AppDelegate bridge for VoIP push → CallKit.
//
// Replace the body of ios/Runner/AppDelegate.swift with this after
// `flutter create .`. It wires Apple PushKit (the only reliable way to wake an
// iOS app for an incoming call) to flutter_callkit_incoming, which reports the
// call to CallKit and forwards the accept/decline events into Dart.
//
// Requires (Xcode → Runner target → Signing & Capabilities):
//   * Push Notifications
//   * Background Modes: Voice over IP, Audio, Remote notifications
// and `pod 'PushKit'` is part of iOS SDK (no extra pod needed).

import UIKit
import Flutter
import PushKit
import flutter_callkit_incoming

@main
@objc class AppDelegate: FlutterAppDelegate, PKPushRegistryDelegate {

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    GeneratedPluginRegistrant.register(with: self)

    // Register for VoIP pushes.
    let registry = PKPushRegistry(queue: nil)
    registry.delegate = self
    registry.desiredPushTypes = [.voIP]

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // The VoIP token — flutter_callkit_incoming also exposes this to Dart via
  // getDevicePushTokenVoIP(); registering it here keeps the native side in sync.
  func pushRegistry(_ registry: PKPushRegistry,
                    didUpdate pushCredentials: PKPushCredentials,
                    for type: PKPushType) {
    let deviceToken = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
    SwiftFlutterCallkitIncomingPlugin.sharedInstance?.setDevicePushTokenVoIP(deviceToken)
  }

  func pushRegistry(_ registry: PKPushRegistry,
                    didInvalidatePushTokenFor type: PKPushType) {
    SwiftFlutterCallkitIncomingPlugin.sharedInstance?.setDevicePushTokenVoIP("")
  }

  // Incoming VoIP push → report to CallKit (MUST report synchronously here, or
  // iOS will terminate the app for not surfacing a call).
  func pushRegistry(_ registry: PKPushRegistry,
                    didReceiveIncomingPushWith payload: PKPushPayload,
                    for type: PKPushType,
                    completion: @escaping () -> Void) {
    let dict = payload.dictionaryPayload
    let callId = (dict["callId"] as? String) ?? UUID().uuidString
    let from = (dict["from"] as? String) ?? "Unknown"
    let fromName = (dict["fromName"] as? String) ?? from

    let data = flutter_callkit_incoming.Data(
      id: callId,
      nameCaller: fromName,
      handle: from,
      type: 0
    )
    data.extra = ["number": from, "callId": callId]

    SwiftFlutterCallkitIncomingPlugin.sharedInstance?.showCallkitIncoming(data, fromPushKit: true)
    completion()
  }
}
