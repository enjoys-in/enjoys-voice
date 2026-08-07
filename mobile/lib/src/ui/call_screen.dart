import 'dart:async';

import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:provider/provider.dart';

import '../models/call.dart';
import '../services/phone_service.dart';
import '../services/tone_service.dart';
import 'theme.dart';

class CallScreen extends StatefulWidget {
  const CallScreen({super.key});

  @override
  State<CallScreen> createState() => _CallScreenState();
}

class _CallScreenState extends State<CallScreen>
    with SingleTickerProviderStateMixin {
  Timer? _ticker;
  late final AnimationController _pulse;
  ToneService? _tones;
  bool _ringback = false;

  @override
  void initState() {
    super.initState();
    _pulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    )..repeat();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _tones ??= context.read<ToneService>();
  }

  @override
  void dispose() {
    _ticker?.cancel();
    _pulse.dispose();
    _tones?.stopRingback();
    super.dispose();
  }

  /// Play the outgoing ringback beep only while our own call is ringing.
  void _syncRingback(ActiveCall call) {
    final shouldRing = !call.isIncoming &&
        (call.phase == CallPhase.ringing || call.phase == CallPhase.connecting);
    if (shouldRing == _ringback) return;
    _ringback = shouldRing;
    if (shouldRing) {
      _tones?.startRingback();
    } else {
      _tones?.stopRingback();
    }
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
    final isRinging = call.phase == CallPhase.ringing ||
        call.phase == CallPhase.connecting;
    _syncRingback(call);

    return Scaffold(
      resizeToAvoidBottomInset: false,
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Color(0xFF1E1B33), Color(0xFF0A0A0F)],
          ),
        ),
        child: SafeArea(
          child: Column(
            children: [
              const SizedBox(height: 20),
              _StatusPill(
                label: _statusText(call),
                accent: inCall
                    ? AppColors.emeraldLight
                    : (call.phase == CallPhase.failed
                        ? AppColors.danger
                        : AppColors.amber),
              ),
              Expanded(
                child: Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      _Avatar(
                        name: call.displayName,
                        pulse: _pulse,
                        animate: isRinging,
                        ringColor: ringingIncoming
                            ? AppColors.emeraldLight
                            : AppColors.brandStart,
                      ),
                      const SizedBox(height: 28),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 24),
                        child: Text(
                          call.displayName,
                          textAlign: TextAlign.center,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 28,
                            color: Colors.white,
                            fontWeight: FontWeight.w700,
                            letterSpacing: -0.5,
                          ),
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        call.peer,
                        style: TextStyle(
                          fontSize: 15,
                          color: Colors.white.withValues(alpha: 0.6),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              if (inCall) ...[
                _InCallControls(phone: phone, call: call, tones: _tones),
                const SizedBox(height: 36),
              ],
              _ActionRow(
                phone: phone,
                call: call,
                ringingIncoming: ringingIncoming,
              ),
              const SizedBox(height: 40),
            ],
          ),
        ),
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.label, required this.accent});
  final String label;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    if (label.isEmpty) return const SizedBox(height: 28);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 7,
            height: 7,
            decoration: BoxDecoration(color: accent, shape: BoxShape.circle),
          ),
          const SizedBox(width: 8),
          Text(
            label,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 14,
              fontWeight: FontWeight.w500,
              fontFeatures: [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }
}

class _Avatar extends StatelessWidget {
  const _Avatar({
    required this.name,
    required this.pulse,
    required this.animate,
    required this.ringColor,
  });
  final String name;
  final AnimationController pulse;
  final bool animate;
  final Color ringColor;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 200,
      height: 200,
      child: Stack(
        alignment: Alignment.center,
        children: [
          if (animate)
            AnimatedBuilder(
              animation: pulse,
              builder: (context, _) {
                final t = pulse.value;
                return Container(
                  width: 130 + t * 70,
                  height: 130 + t * 70,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: ringColor.withValues(alpha: (1 - t) * 0.35),
                  ),
                );
              },
            ),
          Container(
            width: 128,
            height: 128,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: AppColors.brandGradient,
              boxShadow: [
                BoxShadow(
                  color: AppColors.brandStart.withValues(alpha: 0.5),
                  blurRadius: 32,
                  spreadRadius: 2,
                ),
              ],
            ),
            child: Text(
              _initials(name),
              style: const TextStyle(
                fontSize: 44,
                color: Colors.white,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
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
  const _InCallControls({required this.phone, required this.call, this.tones});
  final PhoneService phone;
  final ActiveCall call;
  final ToneService? tones;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 28),
      child: Row(
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
      ),
    );
  }

  void _showDtmf(BuildContext context, PhoneService phone) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: const Color(0xFF15131F),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) {
        const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
        return SafeArea(
          child: GridView.count(
            crossAxisCount: 3,
            shrinkWrap: true,
            padding: const EdgeInsets.all(20),
            childAspectRatio: 1.6,
            children: [
              for (final k in keys)
                TextButton(
                  onPressed: () {
                    tones?.playDtmf(k);
                    phone.sendDtmf(k);
                  },
                  child: Text(
                    k,
                    style: const TextStyle(fontSize: 26, color: Colors.white),
                  ),
                ),
            ],
          ),
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
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 48),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            _CircleButton(
              color: AppColors.danger,
              icon: Icons.call_end,
              label: 'Decline',
              onTap: phone.hangup,
            ),
            _CircleButton(
              color: AppColors.emerald,
              icon: Icons.call,
              label: 'Accept',
              onTap: () async {
                final mic = await Permission.microphone.request();
                if (mic.isGranted) await phone.answer();
              },
            ),
          ],
        ),
      );
    }
    return _CircleButton(
      color: AppColors.danger,
      icon: Icons.call_end,
      label: 'End',
      onTap: phone.hangup,
    );
  }
}

class _CircleButton extends StatelessWidget {
  const _CircleButton({
    required this.color,
    required this.icon,
    required this.onTap,
    this.label,
  });
  final Color color;
  final IconData icon;
  final VoidCallback onTap;
  final String? label;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Material(
          color: color,
          shape: const CircleBorder(),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: onTap,
            customBorder: const CircleBorder(),
            child: SizedBox(
              width: 72,
              height: 72,
              child: Icon(icon, color: Colors.white, size: 30),
            ),
          ),
        ),
        if (label != null) ...[
          const SizedBox(height: 10),
          Text(
            label!,
            style: TextStyle(color: Colors.white.withValues(alpha: 0.7), fontSize: 13),
          ),
        ],
      ],
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
        Material(
          color: active ? Colors.white : Colors.white.withValues(alpha: 0.12),
          shape: const CircleBorder(),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: onTap,
            customBorder: const CircleBorder(),
            child: SizedBox(
              width: 60,
              height: 60,
              child: Icon(
                icon,
                color: active ? const Color(0xFF1E1B33) : Colors.white,
                size: 24,
              ),
            ),
          ),
        ),
        const SizedBox(height: 8),
        Text(
          label,
          style: TextStyle(color: Colors.white.withValues(alpha: 0.7), fontSize: 12),
        ),
      ],
    );
  }
}
