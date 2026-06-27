import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../models/directory.dart';
import '../../services/directory_service.dart';
import '../../services/phone_service.dart';
import '../../state/session_controller.dart';
import '../theme.dart';
import '../widgets/initials_avatar.dart';

/// Call history (Recents). Tap a row to pre-fill the dialer; tap the call icon
/// to redial immediately.
class RecentsScreen extends StatefulWidget {
  const RecentsScreen({super.key, required this.onDial, this.active = true});

  final void Function(String number) onDial;

  /// Whether this is the currently-selected tab. When it becomes active the
  /// list re-fetches so newly-completed calls show up immediately.
  final bool active;

  @override
  State<RecentsScreen> createState() => _RecentsScreenState();
}

class _RecentsScreenState extends State<RecentsScreen> {
  late Future<List<CallRecord>> _future;
  PhoneService? _phone;
  bool _hadCall = false;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final phone = context.read<PhoneService>();
    if (!identical(phone, _phone)) {
      _phone?.removeListener(_onPhoneChange);
      _phone = phone..addListener(_onPhoneChange);
    }
  }

  @override
  void didUpdateWidget(covariant RecentsScreen old) {
    super.didUpdateWidget(old);
    // Re-fetch whenever the user switches back to the Recents tab.
    if (widget.active && !old.active) _refresh();
  }

  @override
  void dispose() {
    _phone?.removeListener(_onPhoneChange);
    super.dispose();
  }

  /// When an active call finishes, refresh so it lands in the list at once.
  void _onPhoneChange() {
    final hasCall = _phone?.active != null;
    if (_hadCall && !hasCall && mounted) _refresh();
    _hadCall = hasCall;
  }

  Future<List<CallRecord>> _load() {
    final ext = context.read<SessionController>().user?.extension;
    return context.read<DirectoryService>().recents(ext);
  }

  Future<void> _refresh() async {
    final next = _load();
    if (!mounted) return;
    setState(() {
      _future = next;
    });
    await next;
  }

  Future<void> _clearAll() async {
    final ext = context.read<SessionController>().user?.extension;
    if (ext == null || ext.isEmpty) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Clear all recents?'),
        content: const Text('This permanently removes your entire call history.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Clear all'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await context.read<DirectoryService>().clearRecents(ext);
      if (!mounted) return;
      // Clear the list optimistically (mirrors the web client). The backend
      // GET right after the DELETE can still return stale rows, so don't
      // re-fetch here — the next tab activation reconciles.
      setState(() {
        _future = Future.value(const <CallRecord>[]);
      });
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Call history cleared')));
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Could not clear history')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final myExt = context.watch<SessionController>().user?.extension;
    return SafeArea(
      bottom: false,
      child: Column(
        children: [
          _Header(title: 'Recents', onRefresh: _refresh, onClearAll: _clearAll),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _refresh,
              child: FutureBuilder<List<CallRecord>>(
                future: _future,
                builder: (context, snap) {
                  if (snap.connectionState == ConnectionState.waiting) {
                    return const Center(child: CircularProgressIndicator());
                  }
                  if (snap.hasError) {
                    return _ErrorState(onRetry: _refresh, message: 'Couldn\'t load calls');
                  }
                  final calls = snap.data ?? const [];
                  if (calls.isEmpty) {
                    return const _EmptyState(
                      icon: Icons.history,
                      title: 'No recent calls',
                      subtitle: 'Your call history will appear here.',
                    );
                  }
                  return ListView.separated(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    itemCount: calls.length,
                    separatorBuilder: (_, __) => Divider(
                      height: 1,
                      indent: 76,
                      color: scheme.outlineVariant.withValues(alpha: 0.5),
                    ),
                    itemBuilder: (context, i) => _CallTile(
                      record: calls[i],
                      myExt: myExt,
                      onDial: widget.onDial,
                    ),
                  );
                },
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CallTile extends StatelessWidget {
  const _CallTile({required this.record, required this.onDial, this.myExt});
  final CallRecord record;
  final void Function(String) onDial;
  final String? myExt;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final outbound = record.isOutbound(myExt);
    final missed = record.isMissed(myExt);
    final peer = record.peer(myExt);
    final IconData dirIcon = outbound
        ? Icons.call_made
        : (missed ? Icons.call_missed : Icons.call_received);
    final dirColor = missed ? AppColors.danger : scheme.onSurfaceVariant;
    final title = record.peerName(myExt);

    return ListTile(
      onTap: () => onDial(peer),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      leading: InitialsAvatar(label: title, size: 44),
      title: Text(
        title,
        style: TextStyle(
          fontWeight: FontWeight.w600,
          color: missed ? AppColors.danger : scheme.onSurface,
        ),
        overflow: TextOverflow.ellipsis,
      ),
      subtitle: Row(
        children: [
          Icon(dirIcon, size: 14, color: dirColor),
          const SizedBox(width: 5),
          Flexible(
            child: Text(
              _relativeTime(record.startTime),
              style: TextStyle(fontSize: 12.5, color: scheme.onSurfaceVariant),
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
      trailing: IconButton(
        icon: const Icon(Icons.call, color: AppColors.emerald),
        onPressed: () => onDial(peer),
      ),
    );
  }
}

String _relativeTime(DateTime t) {
  final now = DateTime.now();
  final diff = now.difference(t);
  if (diff.inMinutes < 1) return 'Just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes} min ago';
  if (diff.inHours < 24 && now.day == t.day) {
    final h = t.hour % 12 == 0 ? 12 : t.hour % 12;
    final m = t.minute.toString().padLeft(2, '0');
    final ap = t.hour < 12 ? 'AM' : 'PM';
    return '$h:$m $ap';
  }
  if (diff.inDays < 2) return 'Yesterday';
  if (diff.inDays < 7) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return days[t.weekday - 1];
  }
  return '${t.day}/${t.month}/${t.year}';
}

class _Header extends StatelessWidget {
  const _Header({required this.title, this.onRefresh, this.onClearAll});
  final String title;
  final Future<void> Function()? onRefresh;
  final Future<void> Function()? onClearAll;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 8, 8),
      child: Row(
        children: [
          Expanded(
            child: Text(
              title,
              style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w700, letterSpacing: -0.5),
            ),
          ),
          if (onClearAll != null)
            TextButton.icon(
              onPressed: onClearAll,
              icon: const Icon(Icons.delete_sweep_outlined, size: 18),
              label: const Text('Clear all'),
              style: TextButton.styleFrom(foregroundColor: AppColors.danger),
            ),
          if (onRefresh != null)
            IconButton(
              icon: const Icon(Icons.refresh),
              onPressed: onRefresh,
            ),
        ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.icon, required this.title, required this.subtitle});
  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ListView(
      children: [
        const SizedBox(height: 96),
        Icon(icon, size: 56, color: scheme.onSurfaceVariant.withValues(alpha: 0.4)),
        const SizedBox(height: 16),
        Text(
          title,
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 4),
        Text(
          subtitle,
          textAlign: TextAlign.center,
          style: TextStyle(color: scheme.onSurfaceVariant),
        ),
      ],
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.onRetry, required this.message});
  final Future<void> Function() onRetry;
  final String message;

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: [
        const SizedBox(height: 96),
        const Icon(Icons.cloud_off, size: 48),
        const SizedBox(height: 12),
        Text(message, textAlign: TextAlign.center),
        const SizedBox(height: 16),
        Center(
          child: OutlinedButton(onPressed: onRetry, child: const Text('Retry')),
        ),
      ],
    );
  }
}
