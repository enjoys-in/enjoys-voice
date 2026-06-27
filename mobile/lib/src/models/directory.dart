/// Read-only models for the Recents (call history) and Contacts screens.

enum CallLogDirection { inbound, outbound }

class CallRecord {
  const CallRecord({
    required this.id,
    required this.from,
    required this.to,
    required this.fromName,
    required this.status,
    required this.direction,
    required this.startTime,
    this.duration,
  });

  final String id;
  final String from;
  final String to;
  final String fromName;
  final String status; // answered | missed | voicemail | failed | busy | ...
  final CallLogDirection direction;
  final DateTime startTime;
  final int? duration; // seconds

  /// True when the signed-in user ([myExt]) placed this call. Computed RELATIVE
  /// to the user: internal calls are stored as direction:'inbound' regardless
  /// of who dialled, so we must not trust [direction] alone (mirrors the web —
  /// `call.from === myExt` means I placed it).
  bool isOutbound(String? myExt) =>
      direction == CallLogDirection.outbound ||
      (myExt != null && myExt.isNotEmpty && from == myExt);

  /// The OTHER party's number/extension relative to [myExt] (never yourself).
  String peer(String? myExt) => isOutbound(myExt) ? to : from;

  /// Display label for the other party: outbound shows the dialled number;
  /// inbound prefers the caller's name, then the raw number. Never your own.
  String peerName(String? myExt) =>
      isOutbound(myExt) ? to : (fromName.isNotEmpty ? fromName : from);

  /// A missed call = an inbound call we did not pick up.
  bool isMissed(String? myExt) =>
      !isOutbound(myExt) &&
      (status == 'missed' || status == 'no_answer' || status == 'failed');

  factory CallRecord.fromJson(Map<String, dynamic> json) {
    final dir = (json['direction'] ?? '').toString().toLowerCase();
    return CallRecord(
      id: (json['id'] ?? '').toString(),
      from: (json['from'] ?? '') as String,
      to: (json['to'] ?? '') as String,
      fromName: (json['fromName'] ?? '') as String,
      status: (json['status'] ?? '').toString().toLowerCase(),
      direction:
          dir.contains('in') ? CallLogDirection.inbound : CallLogDirection.outbound,
      startTime: DateTime.tryParse((json['startTime'] ?? '') as String)?.toLocal() ??
          DateTime.now(),
      duration: json['duration'] is int ? json['duration'] as int : null,
    );
  }
}

class Contact {
  const Contact({
    this.id = 0,
    required this.name,
    required this.extension,
    this.username = '',
    this.online = false,
    this.registered = false,
  });

  final int id;
  final String name;
  final String extension;
  final String username;
  final bool online;
  final bool registered;

  factory Contact.fromJson(Map<String, dynamic> json) => Contact(
        id: json['id'] is int
            ? json['id'] as int
            : int.tryParse('${json['id'] ?? ''}') ?? 0,
        name: (json['name'] ?? '') as String,
        extension: (json['extension'] ?? '') as String,
        username: (json['username'] ?? '') as String,
        online: (json['online'] ?? false) as bool,
        registered: (json['registered'] ?? false) as bool,
      );
}
