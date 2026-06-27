import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:provider/provider.dart';
import 'package:sip_ua/sip_ua.dart';

import '../../config/app_config.dart';
import '../../services/phone_service.dart';
import '../../state/session_controller.dart';
import '../theme.dart';
import '../widgets/initials_avatar.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final session = context.watch<SessionController>();
    final phone = context.watch<PhoneService>();
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
