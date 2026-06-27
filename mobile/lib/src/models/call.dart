/// Lightweight call model shared across the SIP service and the UI layer.

enum CallDir { incoming, outgoing }

/// High-level call status the UI cares about. Derived from sip_ua's
/// `CallStateEnum` so screens don't depend on the SIP library directly.
enum CallPhase {
  idle,
  ringing, // outgoing: remote alerting / incoming: being offered
  connecting,
  active,
  held,
  ended,
  failed,
}

class ActiveCall {
  ActiveCall({
    required this.id,
    required this.direction,
    required this.peer,
    this.peerName,
    this.phase = CallPhase.idle,
    this.muted = false,
    this.onHold = false,
    this.speakerOn = false,
    DateTime? startedAt,
  }) : startedAt = startedAt ?? DateTime.now();

  final String id;
  final CallDir direction;

  /// The remote number / extension.
  final String peer;
  final String? peerName;

  CallPhase phase;
  bool muted;
  bool onHold;
  bool speakerOn;
  DateTime startedAt;

  /// When the call became [CallPhase.active]; used for the in-call timer.
  DateTime? connectedAt;

  String get displayName => (peerName != null && peerName!.isNotEmpty) ? peerName! : peer;

  bool get isIncoming => direction == CallDir.incoming;

  ActiveCall copyWith({
    CallPhase? phase,
    bool? muted,
    bool? onHold,
    bool? speakerOn,
    String? peerName,
  }) {
    final c = ActiveCall(
      id: id,
      direction: direction,
      peer: peer,
      peerName: peerName ?? this.peerName,
      phase: phase ?? this.phase,
      muted: muted ?? this.muted,
      onHold: onHold ?? this.onHold,
      speakerOn: speakerOn ?? this.speakerOn,
      startedAt: startedAt,
    );
    c.connectedAt = connectedAt;
    return c;
  }
}
