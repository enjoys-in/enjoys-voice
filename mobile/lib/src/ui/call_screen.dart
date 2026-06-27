import 'dart:async';

import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:provider/provider.dart';

import '../models/call.dart';
import '../services/phone_service.dart';

class CallScreen extends StatefulWidget {
  const CallScreen({super.key});

  @override
  State<CallScreen> createState() => _CallScreenState();
}

class _CallScreenState extends State<CallScreen> {
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  String _statusText(ActiveCall c) {
    switch (c.phase) {
      case CallPhase.ringing:
        return c.isIncoming ? 'Incoming call' : 'Ringing…';
      case CallPhase.connecting:
        return 'Connecting…';
      case CallPhase.active:
        return _elapsed(c);
      case CallPhase.held:
        return 'On hold';
      case CallPhase.ended:
        return 'Call ended';
      case CallPhase.failed:
        return 'Call failed';
      case CallPhase.idle:
        return '';
    }
  }

  String _elapsed(ActiveCall c) {
    final start = c.connectedAt;
    if (start == null) return '00:00';
    final d = DateTime.now().difference(start);
    final m = d.inMinutes.remainder(60).toString().padLeft(2, '0');
    final s = d.inSeconds.remainder(60).toString().padLeft(2, '0');
    final h = d.inHours;
    return h > 0 ? '$h:$m:$s' : '$m:$s';
  }

  @override
  Widget build(BuildContext context) {
    final phone = context.watch<PhoneService>();
    final call = phone.active;
    if (call == null) {
      // Call cleared — pop back to whatever is underneath.
      return const SizedBox.shrink();
    }

    final ringingIncoming = call.isIncoming && call.phase == CallPhase.ringing;
    final inCall = call.phase == CallPhase.active || call.phase == CallPhase.held;

    return Scaffold(
      backgroundColor: const Color(0xFF0a2540),
      body: SafeArea(
        child: Column(
          children: [
            const SizedBox(height: 48),
            CircleAvatar(
              radius: 56,
              backgroundColor: Colors.white24,
              child: Text(
                _initials(call.displayName),
                style: const TextStyle(fontSize: 36, color: Colors.white),
              ),
            ),
            const SizedBox(height: 24),
            Text(
              call.displayName,
              style: const TextStyle(fontSize: 26, color: Colors.white, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            Text(
              _statusText(call),
              style: const TextStyle(fontSize: 16, color: Colors.white70),
            ),
            const Spacer(),
            if (inCall) _InCallControls(phone: phone, call: call),
            const SizedBox(height: 32),
            _ActionRow(
              phone: phone,
              call: call,
              ringingIncoming: ringingIncoming,
            ),
            const SizedBox(height: 48),
          ],
        ),
      ),
    );
  }

  String _initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) return '?';
    if (parts.length == 1) return parts.first.characters.first.toUpperCase();
    return (parts.first.characters.first + parts.last.characters.first).toUpperCase();
  }
}

class _InCallControls extends StatelessWidget {
  const _InCallControls({required this.phone, required this.call});
  final PhoneService phone;
  final ActiveCall call;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: [
        _RoundToggle(
          icon: call.muted ? Icons.mic_off : Icons.mic,
          label: 'Mute',
          active: call.muted,
          onTap: phone.toggleMute,
        ),
        _RoundToggle(
          icon: Icons.dialpad,
          label: 'Keypad',
          active: false,
          onTap: () => _showDtmf(context, phone),
        ),
        _RoundToggle(
          icon: call.speakerOn ? Icons.volume_up : Icons.volume_down,
          label: 'Speaker',
          active: call.speakerOn,
          onTap: phone.toggleSpeaker,
        ),
        _RoundToggle(
          icon: Icons.pause,
          label: 'Hold',
          active: call.onHold,
          onTap: phone.toggleHold,
        ),
      ],
    );
  }

  void _showDtmf(BuildContext context, PhoneService phone) {
    showModalBottomSheet<void>(
      context: context,
      builder: (_) {
        const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
        return GridView.count(
          crossAxisCount: 3,
          shrinkWrap: true,
          padding: const EdgeInsets.all(16),
          children: [
            for (final k in keys)
              TextButton(
                onPressed: () => phone.sendDtmf(k),
                child: Text(k, style: const TextStyle(fontSize: 26)),
              ),
          ],
        );
      },
    );
  }
}

class _ActionRow extends StatelessWidget {
  const _ActionRow({
    required this.phone,
    required this.call,
    required this.ringingIncoming,
  });
  final PhoneService phone;
  final ActiveCall call;
  final bool ringingIncoming;

  @override
  Widget build(BuildContext context) {
    if (ringingIncoming) {
      return Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          _CircleButton(
            color: Colors.red,
            icon: Icons.call_end,
            onTap: phone.hangup,
          ),
          _CircleButton(
            color: Colors.green,
            icon: Icons.call,
            onTap: () async {
              final mic = await Permission.microphone.request();
              if (mic.isGranted) await phone.answer();
            },
          ),
        ],
      );
    }
    return _CircleButton(
      color: Colors.red,
      icon: Icons.call_end,
      onTap: phone.hangup,
    );
  }
}

class _CircleButton extends StatelessWidget {
  const _CircleButton({required this.color, required this.icon, required this.onTap});
  final Color color;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 72,
        height: 72,
        decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        child: Icon(icon, color: Colors.white, size: 32),
      ),
    );
  }
}

class _RoundToggle extends StatelessWidget {
  const _RoundToggle({
    required this.icon,
    required this.label,
    required this.active,
    required this.onTap,
  });
  final IconData icon;
  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        IconButton.filled(
          onPressed: onTap,
          isSelected: active,
          icon: Icon(icon),
          style: IconButton.styleFrom(
            backgroundColor: active ? Colors.white : Colors.white24,
            foregroundColor: active ? const Color(0xFF0a2540) : Colors.white,
          ),
        ),
        const SizedBox(height: 6),
        Text(label, style: const TextStyle(color: Colors.white70, fontSize: 12)),
      ],
    );
  }
}
