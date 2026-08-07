import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:provider/provider.dart';
import 'package:sip_ua/sip_ua.dart';

import '../../config/app_config.dart';
import '../../services/phone_service.dart';
import '../../services/settings_service.dart';
import '../../state/session_controller.dart';
import '../theme.dart';
import '../widgets/initials_avatar.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final _busyCtl = TextEditingController();
  final _noAnswerCtl = TextEditingController();
  final _unavailCtl = TextEditingController();
  final _pstnMobileCtl = TextEditingController();
  final _pstnCcCtl = TextEditingController();
  final _blockCtl = TextEditingController();

  final _busyFocus = FocusNode();
  final _noAnswerFocus = FocusNode();
  final _unavailFocus = FocusNode();
  final _pstnMobileFocus = FocusNode();
  final _pstnCcFocus = FocusNode();

  /// Controllers are seeded from the service exactly once, after the initial
  /// load, so live edits are never clobbered by later rebuilds.
  bool _synced = false;

  @override
  void initState() {
    super.initState();
    _busyFocus.addListener(() => _onForwardingBlur(_busyFocus, 'busy', _busyCtl));
    _noAnswerFocus
        .addListener(() => _onForwardingBlur(_noAnswerFocus, 'noAnswer', _noAnswerCtl));
    _unavailFocus.addListener(
        () => _onForwardingBlur(_unavailFocus, 'unavailable', _unavailCtl));
    _pstnMobileFocus.addListener(_onPstnBlur);
    _pstnCcFocus.addListener(_onPstnBlur);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final ext = context.read<SessionController>().user?.extension;
      if (ext != null && ext.isNotEmpty) {
        context.read<SettingsService>().load(ext);
      }
    });
  }

  @override
  void dispose() {
    _busyCtl.dispose();
    _noAnswerCtl.dispose();
    _unavailCtl.dispose();
    _pstnMobileCtl.dispose();
    _pstnCcCtl.dispose();
    _blockCtl.dispose();
    _busyFocus.dispose();
    _noAnswerFocus.dispose();
    _unavailFocus.dispose();
    _pstnMobileFocus.dispose();
    _pstnCcFocus.dispose();
    super.dispose();
  }

  void _syncControllers(SettingsService s) {
    if (_synced || !s.isLoaded) return;
    _busyCtl.text = s.forwardBusy;
    _noAnswerCtl.text = s.forwardNoAnswer;
    _unavailCtl.text = s.forwardUnavailable;
    _pstnMobileCtl.text = s.pstnMobile;
    _pstnCcCtl.text = s.pstnCountryCode;
    _synced = true;
  }

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  void _saveForwarding(String type, String value) {
    final s = context.read<SettingsService>();
    final v = value.trim();
    final current = switch (type) {
      'busy' => s.forwardBusy,
      'noAnswer' => s.forwardNoAnswer,
      _ => s.forwardUnavailable,
    };
    if (v == current) return;
    s.setForwarding(type, v).catchError((_) => _toast('Could not save forwarding'));
  }

  void _onForwardingBlur(FocusNode node, String type, TextEditingController ctl) {
    if (node.hasFocus) return;
    _saveForwarding(type, ctl.text);
  }

  void _onPstnBlur() {
    if (_pstnMobileFocus.hasFocus || _pstnCcFocus.hasFocus) return;
    final s = context.read<SettingsService>();
    final mobile = _pstnMobileCtl.text.trim();
    final cc = _pstnCcCtl.text.trim().isEmpty ? '+91' : _pstnCcCtl.text.trim();
    if (mobile == s.pstnMobile && cc == s.pstnCountryCode) return;
    s
        .savePstn(enabled: s.pstnEnabled, mobile: mobile, countryCode: cc)
        .catchError((_) => _toast('Could not save PSTN number'));
  }

  void _addBlocked() {
    final n = _blockCtl.text.trim();
    if (n.isEmpty) return;
    context
        .read<SettingsService>()
        .blockNumber(n)
        .catchError((_) => _toast('Could not block number'));
    _blockCtl.clear();
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<SessionController>();
    final phone = context.watch<PhoneService>();
    final settings = context.watch<SettingsService>();
    _syncControllers(settings);
    final scheme = Theme.of(context).colorScheme;
    final user = session.user;
    final registered = phone.registrationState == RegistrationStateEnum.REGISTERED;

    return SafeArea(
      bottom: false,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(4, 0, 4, 16),
            child: Text(
              'Settings',
              style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700, letterSpacing: -0.5),
            ),
          ),
          // Profile card.
          Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Row(
                children: [
                  InitialsAvatar(label: user?.name ?? '#', size: 56),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          user?.name ?? 'Enjoys Voice',
                          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          'Extension ${user?.extension ?? '—'}',
                          style: TextStyle(color: scheme.onSurfaceVariant),
                        ),
                        if ((user?.mobile ?? '').isNotEmpty)
                          Text(
                            user!.mobile,
                            style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13),
                          ),
                      ],
                    ),
                  ),
                  if (user?.isAdmin == true)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        gradient: AppColors.brandGradient,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: const Text(
                        'ADMIN',
                        style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w700),
                      ),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 20),
          _SectionLabel('Connection'),
          Card(
            child: Column(
              children: [
                _InfoTile(
                  icon: registered ? Icons.cloud_done_outlined : Icons.cloud_off_outlined,
                  iconColor: registered ? AppColors.emerald : AppColors.amber,
                  title: 'SIP status',
                  value: registered ? 'Registered' : 'Connecting…',
                ),
                Divider(height: 1, color: scheme.outlineVariant),
                _InfoTile(
                  icon: Icons.dns_outlined,
                  title: 'API server',
                  value: AppConfig.goApiBase,
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),

          if (settings.loading && !settings.isLoaded)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 8),
              child: LinearProgressIndicator(minHeight: 2),
            ),

          // ── Preferences ───────────────────────────────────────────────
          _SectionLabel('Preferences'),
          Card(
            child: Column(
              children: [
                _SwitchTile(
                  icon: Icons.do_not_disturb_on_outlined,
                  title: 'Do Not Disturb',
                  subtitle: 'Silence incoming calls; callers go to voicemail.',
                  value: settings.dnd,
                  onChanged: (v) =>
                      settings.setDnd(v).catchError((_) => _toast('Could not update')),
                ),
                Divider(height: 1, color: scheme.outlineVariant),
                _SwitchTile(
                  icon: Icons.volume_up_outlined,
                  title: 'Sounds',
                  subtitle: 'Ringtones and in-call tones.',
                  value: settings.soundsEnabled,
                  onChanged: (v) => settings
                      .setSoundsEnabled(v)
                      .catchError((_) => _toast('Could not update')),
                ),
                Divider(height: 1, color: scheme.outlineVariant),
                _SwitchTile(
                  icon: Icons.dialpad_outlined,
                  title: 'DTMF keypad tones',
                  subtitle: 'Play a tone when you press keypad keys.',
                  value: settings.dtmfEnabled,
                  onChanged: (v) => settings
                      .setDtmfEnabled(v)
                      .catchError((_) => _toast('Could not update')),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),

          // ── Call Forwarding ───────────────────────────────────────────
          _SectionLabel('Call Forwarding'),
          Card(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 6),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _ForwardField(
                    label: 'On busy',
                    controller: _busyCtl,
                    focusNode: _busyFocus,
                    onSubmitted: (v) => _saveForwarding('busy', v),
                  ),
                  _ForwardField(
                    label: 'On no answer',
                    controller: _noAnswerCtl,
                    focusNode: _noAnswerFocus,
                    onSubmitted: (v) => _saveForwarding('noAnswer', v),
                  ),
                  _ForwardField(
                    label: 'On unavailable',
                    controller: _unavailCtl,
                    focusNode: _unavailFocus,
                    onSubmitted: (v) => _saveForwarding('unavailable', v),
                  ),
                  Padding(
                    padding: const EdgeInsets.only(top: 2, bottom: 6),
                    child: Text(
                      'Enter an extension to forward to. Leave empty to disable.',
                      style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),

          // ── PSTN fallback (Browser → Phone) ───────────────────────────
          _SectionLabel('PSTN Fallback'),
          Card(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 6, 16, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _SwitchTile(
                    icon: Icons.public,
                    title: 'Route calls to my mobile',
                    subtitle: 'Forward to a phone number over the SIP trunk.',
                    value: settings.pstnEnabled,
                    contentPadding: EdgeInsets.zero,
                    onChanged: (v) {
                      final mobile = _pstnMobileCtl.text.trim();
                      final cc = _pstnCcCtl.text.trim().isEmpty
                          ? '+91'
                          : _pstnCcCtl.text.trim();
                      settings
                          .savePstn(enabled: v, mobile: mobile, countryCode: cc)
                          .catchError((_) => _toast('Could not update PSTN'));
                    },
                  ),
                  if (settings.pstnEnabled) ...[
                    const SizedBox(height: 12),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SizedBox(
                          width: 88,
                          child: TextField(
                            controller: _pstnCcCtl,
                            focusNode: _pstnCcFocus,
                            keyboardType: TextInputType.phone,
                            textInputAction: TextInputAction.done,
                            decoration: const InputDecoration(labelText: 'Code'),
                            onSubmitted: (_) => _onPstnBlur(),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: TextField(
                            controller: _pstnMobileCtl,
                            focusNode: _pstnMobileFocus,
                            keyboardType: TextInputType.phone,
                            textInputAction: TextInputAction.done,
                            decoration:
                                const InputDecoration(labelText: 'Mobile number'),
                            onSubmitted: (_) => _onPstnBlur(),
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),

          // ── Blocked numbers ───────────────────────────────────────────
          _SectionLabel('Blocked Numbers'),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (settings.blockedNumbers.isEmpty)
                    Text(
                      'No blocked numbers',
                      style:
                          TextStyle(color: scheme.onSurfaceVariant, fontSize: 13),
                    )
                  else
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: settings.blockedNumbers
                          .map(
                            (n) => InputChip(
                              label: Text(n),
                              onDeleted: () => settings
                                  .unblockNumber(n)
                                  .catchError((_) => _toast('Could not unblock')),
                            ),
                          )
                          .toList(),
                    ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _blockCtl,
                          keyboardType: TextInputType.phone,
                          textInputAction: TextInputAction.done,
                          decoration: const InputDecoration(hintText: 'Add a number…'),
                          onSubmitted: (_) => _addBlocked(),
                        ),
                      ),
                      const SizedBox(width: 10),
                      FilledButton.tonal(
                        style: FilledButton.styleFrom(
                          minimumSize: const Size(0, 52),
                          padding: const EdgeInsets.symmetric(horizontal: 20),
                        ),
                        onPressed: _addBlocked,
                        child: const Text('Add'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),

          // ── Call handling ─────────────────────────────────────────────
          _SectionLabel('Call Handling'),
          Card(
            child: Column(
              children: [
                _SwitchTile(
                  icon: Icons.fiber_manual_record_outlined,
                  title: 'Record calls',
                  subtitle: 'Save recordings of your calls.',
                  value: settings.recordingEnabled,
                  onChanged: (v) => settings
                      .setRecordingEnabled(v)
                      .catchError((_) => _toast('Could not update')),
                ),
                Divider(height: 1, color: scheme.outlineVariant),
                _SwitchTile(
                  icon: Icons.voicemail_outlined,
                  title: 'Voicemail',
                  subtitle: 'Let callers leave a message when you miss a call.',
                  value: settings.voicemailEnabled,
                  onChanged: (v) => settings
                      .setVoicemailEnabled(v)
                      .catchError((_) => _toast('Could not update')),
                ),
              ],
            ),
          ),
          const SizedBox(height: 28),
          FilledButton.tonalIcon(
            style: FilledButton.styleFrom(
              minimumSize: const Size.fromHeight(50),
              backgroundColor: AppColors.danger.withValues(alpha: 0.12),
              foregroundColor: AppColors.danger,
            ),
            onPressed: () => _confirmSignOut(context),
            icon: const Icon(Icons.logout),
            label: const Text('Sign out'),
          ),
          const SizedBox(height: 24),
          Center(
            child: FutureBuilder<PackageInfo>(
              future: PackageInfo.fromPlatform(),
              builder: (context, snap) {
                final info = snap.data;
                final version = info == null
                    ? 'Enjoys Voice'
                    : 'Enjoys Voice · v${info.version} (${info.buildNumber})';
                return Text(
                  version,
                  style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _confirmSignOut(BuildContext context) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sign out?'),
        content: const Text('You will stop receiving calls on this device.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Sign out'),
          ),
        ],
      ),
    );
    if (ok == true && context.mounted) {
      context.read<SettingsService>().reset();
      await context.read<SessionController>().logout();
    }
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 6, bottom: 8),
      child: Text(
        text.toUpperCase(),
        style: TextStyle(
          fontSize: 11,
          letterSpacing: 1,
          fontWeight: FontWeight.w700,
          color: Theme.of(context).colorScheme.onSurfaceVariant,
        ),
      ),
    );
  }
}

class _InfoTile extends StatelessWidget {
  const _InfoTile({
    required this.icon,
    required this.title,
    required this.value,
    this.iconColor,
  });
  final IconData icon;
  final String title;
  final String value;
  final Color? iconColor;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      child: Row(
        children: [
          Icon(icon, size: 20, color: iconColor ?? scheme.onSurfaceVariant),
          const SizedBox(width: 14),
          Text(title, style: const TextStyle(fontWeight: FontWeight.w500)),
          const Spacer(),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.right,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }
}

class _SwitchTile extends StatelessWidget {
  const _SwitchTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.value,
    required this.onChanged,
    this.contentPadding,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;
  final EdgeInsetsGeometry? contentPadding;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: contentPadding ?? const EdgeInsets.fromLTRB(16, 8, 12, 8),
      child: Row(
        children: [
          Icon(icon, size: 20, color: scheme.onSurfaceVariant),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontWeight: FontWeight.w500)),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Switch(value: value, onChanged: onChanged),
        ],
      ),
    );
  }
}

class _ForwardField extends StatelessWidget {
  const _ForwardField({
    required this.label,
    required this.controller,
    required this.focusNode,
    required this.onSubmitted,
  });

  final String label;
  final TextEditingController controller;
  final FocusNode focusNode;
  final ValueChanged<String> onSubmitted;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(left: 2, bottom: 6),
            child: Text(
              label,
              style: TextStyle(
                color: scheme.onSurfaceVariant,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          TextField(
            controller: controller,
            focusNode: focusNode,
            keyboardType: TextInputType.phone,
            textInputAction: TextInputAction.done,
            decoration: const InputDecoration(hintText: 'Extension, e.g. 1002'),
            onSubmitted: onSubmitted,
          ),
        ],
      ),
    );
  }
}
