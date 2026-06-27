import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:provider/provider.dart';
import 'package:sip_ua/sip_ua.dart';

import '../services/phone_service.dart';
import '../state/session_controller.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _dest = TextEditingController();

  @override
  void dispose() {
    _dest.dispose();
    super.dispose();
  }

  void _tap(String d) {
    _dest.text += d;
    _dest.selection = TextSelection.fromPosition(
      TextPosition(offset: _dest.text.length),
    );
  }

  void _backspace() {
    final t = _dest.text;
    if (t.isEmpty) return;
    _dest.text = t.substring(0, t.length - 1);
    _dest.selection = TextSelection.fromPosition(
      TextPosition(offset: _dest.text.length),
    );
  }

  Future<void> _call() async {
    final number = _dest.text.trim();
    if (number.isEmpty) return;
    final mic = await Permission.microphone.request();
    if (!mic.isGranted) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Microphone permission is required to call')),
        );
      }
      return;
    }
    await context.read<PhoneService>().dial(number);
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<SessionController>();
    final phone = context.watch<PhoneService>();
    final user = session.user;

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(user?.name ?? 'Enjoys Voice', style: const TextStyle(fontSize: 16)),
            Text(
              'Ext ${user?.extension ?? '—'}',
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.normal),
            ),
          ],
        ),
        actions: [
          _RegBadge(state: phone.registrationState),
          IconButton(
            tooltip: 'Sign out',
            icon: const Icon(Icons.logout),
            onPressed: () => context.read<SessionController>().logout(),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            const Spacer(),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: TextField(
                controller: _dest,
                readOnly: false,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 32, letterSpacing: 2),
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(
                  border: InputBorder.none,
                  hintText: 'Enter number',
                ),
              ),
            ),
            const SizedBox(height: 12),
            _Dialpad(onTap: _tap),
            const SizedBox(height: 8),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 48),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const SizedBox(width: 56),
                  FloatingActionButton.large(
                    heroTag: 'call',
                    backgroundColor: Colors.green,
                    onPressed: phone.isRegistered ? _call : null,
                    child: const Icon(Icons.call, size: 32),
                  ),
                  IconButton(
                    iconSize: 32,
                    onPressed: _backspace,
                    icon: const Icon(Icons.backspace_outlined),
                  ),
                ],
              ),
            ),
            const Spacer(),
          ],
        ),
      ),
    );
  }
}

class _RegBadge extends StatelessWidget {
  const _RegBadge({required this.state});
  final RegistrationStateEnum? state;

  @override
  Widget build(BuildContext context) {
    final registered = state == RegistrationStateEnum.REGISTERED;
    final color = registered ? Colors.greenAccent : Colors.orangeAccent;
    final label = registered ? 'Online' : 'Connecting';
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: Row(
        children: [
          Icon(Icons.circle, size: 10, color: color),
          const SizedBox(width: 6),
          Text(label, style: const TextStyle(fontSize: 12)),
        ],
      ),
    );
  }
}

class _Dialpad extends StatelessWidget {
  const _Dialpad({required this.onTap});
  final void Function(String) onTap;

  static const _rows = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['*', '0', '#'],
  ];

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 32),
      child: Column(
        children: [
          for (final row in _rows)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  for (final d in row)
                    _DialKey(digit: d, onTap: () => onTap(d)),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _DialKey extends StatelessWidget {
  const _DialKey({required this.digit, required this.onTap});
  final String digit;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 76,
      height: 64,
      child: TextButton(
        onPressed: onTap,
        child: Text(
          digit,
          style: const TextStyle(fontSize: 28, color: Colors.white),
        ),
      ),
    );
  }
}
