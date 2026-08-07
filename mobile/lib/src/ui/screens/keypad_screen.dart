import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:provider/provider.dart';

import '../../services/phone_service.dart';
import '../../services/tone_service.dart';
import '../../state/session_controller.dart';
import '../theme.dart';
import '../widgets/brand_mark.dart';
import '../widgets/presence_badge.dart';

/// The dialer — large number display, lettered keypad and an emerald call
/// button, styled to match the web keypad.
class KeypadScreen extends StatefulWidget {
  const KeypadScreen({super.key, required this.controller});

  final TextEditingController controller;

  @override
  State<KeypadScreen> createState() => _KeypadScreenState();
}

class _KeypadScreenState extends State<KeypadScreen> {
  static const _rows = [
    [_Key('1'), _Key('2', 'ABC'), _Key('3', 'DEF')],
    [_Key('4', 'GHI'), _Key('5', 'JKL'), _Key('6', 'MNO')],
    [_Key('7', 'PQRS'), _Key('8', 'TUV'), _Key('9', 'WXYZ')],
    [_Key('+', ''), _Key('0'), _Key('#')],
  ];

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_onChange);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onChange);
    super.dispose();
  }

  void _onChange() => setState(() {});

  void _tap(String d) {
    HapticFeedback.lightImpact();
    context.read<ToneService>().playDtmf(d);
    final c = widget.controller;
    c.text += d;
    c.selection = TextSelection.fromPosition(TextPosition(offset: c.text.length));
  }

  void _backspace() {
    HapticFeedback.selectionClick();
    final c = widget.controller;
    if (c.text.isEmpty) return;
    c.text = c.text.substring(0, c.text.length - 1);
    c.selection = TextSelection.fromPosition(TextPosition(offset: c.text.length));
  }

  void _clear() {
    HapticFeedback.mediumImpact();
    widget.controller.clear();
  }

  Future<void> _call() async {
    final number = widget.controller.text.trim();
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
    if (!mounted) return;
    await context.read<PhoneService>().dial(number);
  }

  @override
  Widget build(BuildContext context) {
    final phone = context.watch<PhoneService>();
    final session = context.watch<SessionController>();
    final scheme = Theme.of(context).colorScheme;
    final hasNumber = widget.controller.text.isNotEmpty;
    final user = session.user;

    return SafeArea(
      child: Column(
        children: [
          // Compact header: brand + identity + presence.
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 14, 16, 4),
            child: Row(
              children: [
                const BrandMark(size: 34),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        user?.name ?? 'Enjoys Voice',
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                        overflow: TextOverflow.ellipsis,
                      ),
                      Text(
                        'Ext ${user?.extension ?? '—'}',
                        style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
                PresenceBadge(state: phone.registrationState),
              ],
            ),
          ),
          // Adaptive dialer body: centered when there's room, scrollable when
          // the viewport is short (small phones / landscape).
          Expanded(
            child: LayoutBuilder(
              builder: (context, constraints) => SingleChildScrollView(
                child: ConstrainedBox(
                  constraints: BoxConstraints(minHeight: constraints.maxHeight),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.spaceAround,
                    children: [
                      // Number display.
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 24),
                        child: TextField(
                          controller: widget.controller,
                          readOnly: true,
                          showCursor: true,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            fontSize: 34,
                            fontWeight: FontWeight.w300,
                            letterSpacing: 1.5,
                          ),
                          decoration: InputDecoration(
                            border: InputBorder.none,
                            enabledBorder: InputBorder.none,
                            focusedBorder: InputBorder.none,
                            filled: false,
                            hintText: 'Enter number',
                            hintStyle: TextStyle(
                              fontSize: 28,
                              fontWeight: FontWeight.w300,
                              color: scheme.onSurfaceVariant.withValues(alpha: 0.5),
                            ),
                          ),
                        ),
                      ),
                      // Keypad grid.
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 28),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            for (final row in _rows)
                              Padding(
                                padding: const EdgeInsets.symmetric(vertical: 7),
                                child: Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                                  children: [
                                    for (final k in row)
                                      _KeyButton(data: k, onTap: () => _tap(k.digit)),
                                  ],
                                ),
                              ),
                          ],
                        ),
                      ),
                      // Call row: spacer | call | delete.
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 40),
                        child: Row(
                          children: [
                            const SizedBox(width: 56),
                            Expanded(
                              child: Center(
                                child: _CallButton(
                                  enabled: phone.isRegistered && hasNumber,
                                  onTap: _call,
                                ),
                              ),
                            ),
                            SizedBox(
                              width: 56,
                              child: hasNumber
                                  ? IconButton(
                                      iconSize: 26,
                                      color: scheme.onSurfaceVariant,
                                      onPressed: _backspace,
                                      onLongPress: _clear,
                                      icon: const Icon(Icons.backspace_outlined),
                                    )
                                  : null,
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Key {
  const _Key(this.digit, [this.letters]);
  final String digit;
  final String? letters;
}

class _KeyButton extends StatelessWidget {
  const _KeyButton({required this.data, required this.onTap});
  final _Key data;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
      shape: const CircleBorder(),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        customBorder: const CircleBorder(),
        child: SizedBox(
          width: 72,
          height: 72,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                data.digit,
                style: TextStyle(
                  fontSize: 26,
                  fontWeight: FontWeight.w500,
                  color: scheme.onSurface,
                  height: 1.0,
                ),
              ),
              if (data.letters != null && data.letters!.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text(
                    data.letters!,
                    style: TextStyle(
                      fontSize: 9,
                      letterSpacing: 1.2,
                      fontWeight: FontWeight.w600,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CallButton extends StatelessWidget {
  const _CallButton({required this.enabled, required this.onTap});
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: enabled ? 1 : 0.4,
      child: Material(
        color: AppColors.emerald,
        shape: const CircleBorder(),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: enabled ? onTap : null,
          customBorder: const CircleBorder(),
          child: const SizedBox(
            width: 64,
            height: 64,
            child: Icon(Icons.call, color: Colors.white, size: 28),
          ),
        ),
      ),
    );
  }
}
