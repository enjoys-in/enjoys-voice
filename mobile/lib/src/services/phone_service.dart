import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:sip_ua/sip_ua.dart';

import '../config/app_config.dart';
import '../models/auth.dart';
import '../models/call.dart';

/// Owns the SIP-over-WebSocket registration and the single active call.
///
/// Registration mirrors the web client exactly:
///   transport = sipConfig.sipWsUrl, realm = sipConfig.domain,
///   authorizationUser = extension, password = extension (yes, same value),
///   AOR = sip:<extension>@<domain>, displayName = user name.
class PhoneService extends ChangeNotifier implements SipUaHelperListener {
  PhoneService() {
    _helper.addSipUaHelperListener(this);
  }

  final SIPUAHelper _helper = SIPUAHelper();
  SIPUAHelper get helper => _helper;

  SipConfig? _config;
  AppUser? _user;
  Call? _call;

  ActiveCall? active;
  RegistrationStateEnum _regState = RegistrationStateEnum.NONE;
  RegistrationStateEnum get registrationState => _regState;
  bool get isRegistered => _regState == RegistrationStateEnum.REGISTERED;

  /// Fired when a brand-new incoming call is offered over SIP. The app uses
  /// this to raise the native CallKit UI and/or navigate to the incoming
  /// screen.
  void Function(ActiveCall call)? onIncomingCall;

  /// Fired whenever the active call ends or fails (for CallKit teardown / nav).
  void Function(ActiveCall call)? onCallEnded;

  /// Fired when the active call becomes connected.
  void Function(ActiveCall call)? onCallConnected;

  bool get hasActiveCall => active != null && _call != null;

  /// Start (or restart) SIP registration for [user] using [config].
  Future<void> register(SipConfig config, AppUser user) async {
    _config = config;
    _user = user;

    final settings = UaSettings()
      ..webSocketUrl = config.effectiveSipWsUrl
      ..webSocketSettings.allowBadCertificate = true
      ..transportType = TransportType.WS
      ..uri = 'sip:${user.extension}@${config.effectiveDomain}'
      ..authorizationUser = user.extension
      ..password = user.extension // password == extension (matches web client)
      ..displayName = user.name.isNotEmpty ? user.name : user.extension
      ..userAgent = 'EnjoysVoice-Mobile/1.0'
      ..dtmfMode = DtmfMode.RFC2833
      ..iceServers = _iceServers()
      ..register = true;

    await _helper.start(settings);
  }

  Future<void> unregister() async {
    try {
      _helper.stop();
    } catch (_) {}
    _config = null;
    _user = null;
    _regState = RegistrationStateEnum.NONE;
    active = null;
    _call = null;
    notifyListeners();
  }

  List<Map<String, String>> _iceServers() {
    List<dynamic> raw = AppConfig.defaultIceServers;
    if (AppConfig.iceServersJson.isNotEmpty) {
      try {
        final parsed = jsonDecode(AppConfig.iceServersJson);
        if (parsed is List) raw = parsed;
      } catch (_) {
        // fall through to defaults
      }
    }
    return raw
        .map<Map<String, String>>((e) => (e as Map)
            .map((k, v) => MapEntry(k.toString(), v.toString())))
        .toList();
  }

  // ─── Call control ────────────────────────────────────────────────────────

  Future<void> dial(String number) async {
    if (_config == null || number.trim().isEmpty) return;
    final target = 'sip:${number.trim()}@${_config!.effectiveDomain}';
    await _helper.call(target, voiceOnly: true);
  }

  Future<void> answer() async {
    final call = _call;
    if (call == null) return;
    call.answer(_helper.buildCallOptions(true));
  }

  Future<void> hangup() async {
    final call = _call;
    if (call == null) return;
    try {
      call.hangup();
    } catch (_) {}
  }

  void toggleMute() {
    final call = _call;
    final a = active;
    if (call == null || a == null) return;
    if (a.muted) {
      call.unmute(true, false);
    } else {
      call.mute(true, false);
    }
    active = a.copyWith(muted: !a.muted);
    notifyListeners();
  }

  void toggleHold() {
    final call = _call;
    final a = active;
    if (call == null || a == null) return;
    if (a.onHold) {
      call.unhold();
    } else {
      call.hold();
    }
    active = a.copyWith(onHold: !a.onHold);
    notifyListeners();
  }

  Future<void> toggleSpeaker() async {
    final a = active;
    if (a == null) return;
    final next = !a.speakerOn;
    await Helper.setSpeakerphoneOn(next);
    active = a.copyWith(speakerOn: next);
    notifyListeners();
  }

  void sendDtmf(String tone) {
    _call?.sendDTMF(tone);
  }

  // ─── SipUaHelperListener ─────────────────────────────────────────────────

  @override
  void registrationStateChanged(RegistrationState state) {
    _regState = state.state ?? RegistrationStateEnum.NONE;
    notifyListeners();
  }

  @override
  void transportStateChanged(TransportState state) {
    notifyListeners();
  }

  @override
  void callStateChanged(Call call, CallState state) {
    switch (state.state) {
      case CallStateEnum.CALL_INITIATION:
        _onNewCall(call);
        break;
      case CallStateEnum.PROGRESS:
        _setPhase(CallPhase.ringing);
        break;
      case CallStateEnum.CONNECTING:
      case CallStateEnum.ACCEPTED:
        _setPhase(CallPhase.connecting);
        break;
      case CallStateEnum.CONFIRMED:
        final a = active;
        if (a != null) {
          a.connectedAt ??= DateTime.now();
          active = a.copyWith(phase: CallPhase.active);
          notifyListeners();
          onCallConnected?.call(active!);
        }
        break;
      case CallStateEnum.HOLD:
        _setPhase(CallPhase.held);
        break;
      case CallStateEnum.UNHOLD:
        _setPhase(CallPhase.active);
        break;
      case CallStateEnum.MUTED:
      case CallStateEnum.UNMUTED:
      case CallStateEnum.STREAM:
      case CallStateEnum.REFER:
      case CallStateEnum.NONE:
        break;
      case CallStateEnum.ENDED:
        _onCallTerminated(CallPhase.ended);
        break;
      case CallStateEnum.FAILED:
        _onCallTerminated(CallPhase.failed);
        break;
    }
  }

  void _onNewCall(Call call) {
    final incoming = _isIncoming(call);
    // Reject a second concurrent call — this softphone handles one at a time.
    if (_call != null && _call!.id != call.id) {
      if (incoming) {
        try {
          call.hangup({'status_code': 486}); // Busy Here
        } catch (_) {}
      }
      return;
    }
    _call = call;
    final peer = _peerOf(call);
    active = ActiveCall(
      id: call.id ?? UniqueKey().toString(),
      direction: incoming ? CallDir.incoming : CallDir.outgoing,
      peer: peer,
      peerName: call.remote_display_name,
      phase: incoming ? CallPhase.ringing : CallPhase.connecting,
    );
    notifyListeners();
    if (incoming) {
      onIncomingCall?.call(active!);
    }
  }

  void _onCallTerminated(CallPhase phase) {
    final ended = active?.copyWith(phase: phase);
    _call = null;
    active = null;
    notifyListeners();
    if (ended != null) onCallEnded?.call(ended);
  }

  void _setPhase(CallPhase phase) {
    final a = active;
    if (a == null) return;
    active = a.copyWith(phase: phase);
    notifyListeners();
  }

  bool _isIncoming(Call call) {
    final d = call.direction?.toString().toUpperCase() ?? '';
    return d.contains('INCOMING');
  }

  String _peerOf(Call call) {
    final raw = call.remote_identity ?? '';
    // remote_identity is typically a SIP URI like sip:1002@domain — strip it.
    final m = RegExp(r'sip:([^@]+)@').firstMatch(raw);
    if (m != null) return m.group(1)!;
    return raw.isNotEmpty ? raw : 'unknown';
  }

  @override
  void onNewMessage(SIPMessageRequest msg) {}

  @override
  void onNewNotify(Notify ntf) {}

  @override
  void onNewReinvite(ReInvite event) {}

  @override
  void dispose() {
    _helper.removeSipUaHelperListener(this);
    super.dispose();
  }
}
