import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../models/directory.dart';
import '../../services/directory_service.dart';
import '../theme.dart';
import '../widgets/initials_avatar.dart';

/// Personal address book (per-user). Mirrors the web client: list + search +
/// add / edit / delete against the Go `/contacts` API, plus tap-to-dial.
class ContactsScreen extends StatefulWidget {
  const ContactsScreen({super.key, required this.onDial});

  final void Function(String number) onDial;

  @override
  State<ContactsScreen> createState() => _ContactsScreenState();
}

class _ContactsScreenState extends State<ContactsScreen> {
  late Future<List<Contact>> _future;
  final _searchCtrl = TextEditingController();
  String _query = '';
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _future = _load();
    _searchCtrl.addListener(
        () => setState(() => _query = _searchCtrl.text.trim().toLowerCase()));
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  DirectoryService get _directory => context.read<DirectoryService>();

  Future<List<Contact>> _load() => _directory.contacts();

  Future<void> _refresh() async {
    final next = _load();
    setState(() => _future = next);
    await next;
  }

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  List<Contact> _filter(List<Contact> all) {
    if (_query.isEmpty) return all;
    return all
        .where((c) =>
            c.name.toLowerCase().contains(_query) ||
            c.extension.toLowerCase().contains(_query) ||
            c.username.toLowerCase().contains(_query))
        .toList();
  }

  // ─── Add / Edit / Delete ───────────────────────────────────────────────────

  Future<void> _openForm({Contact? existing}) async {
    final result = await showDialog<_ContactDraft>(
      context: context,
      builder: (_) => _ContactFormDialog(existing: existing),
    );
    if (result == null || _busy) return;

    setState(() => _busy = true);
    try {
      if (existing == null) {
        await _directory.createContact(
            name: result.name, extension: result.extension);
        _toast('Contact added');
      } else {
        await _directory.updateContact(existing.id,
            name: result.name, extension: result.extension);
        _toast('Contact updated');
      }
      await _refresh();
    } catch (_) {
      _toast('Could not save contact');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _confirmDelete(Contact c) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete contact?'),
        content: Text(
            'Remove ${c.name.isEmpty ? c.extension : c.name} from your contacts?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (ok != true || c.id == 0) return;
    try {
      await _directory.deleteContact(c.id);
      _toast('Contact removed');
      await _refresh();
    } catch (_) {
      _toast('Could not delete contact');
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return SafeArea(
      bottom: false,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 12, 8),
            child: Row(
              children: [
                const Expanded(
                  child: Text(
                    'Contacts',
                    style: TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.w700,
                        letterSpacing: -0.5),
                  ),
                ),
                IconButton(
                  tooltip: 'Refresh',
                  icon: const Icon(Icons.refresh, size: 20),
                  onPressed: _busy ? null : _refresh,
                ),
                FilledButton.tonalIcon(
                  onPressed: _busy ? null : () => _openForm(),
                  style: FilledButton.styleFrom(
                    minimumSize: const Size(0, 40),
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                  ),
                  icon: const Icon(Icons.add, size: 18),
                  label: const Text('Add'),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: TextField(
              controller: _searchCtrl,
              decoration: InputDecoration(
                hintText: 'Search contacts',
                prefixIcon: const Icon(Icons.search, size: 20),
                suffixIcon: _query.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.close, size: 18),
                        onPressed: () => _searchCtrl.clear(),
                      )
                    : null,
              ),
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _refresh,
              child: FutureBuilder<List<Contact>>(
                future: _future,
                builder: (context, snap) {
                  if (snap.connectionState == ConnectionState.waiting) {
                    return const Center(child: CircularProgressIndicator());
                  }
                  final contacts = _filter(snap.data ?? const []);
                  if (contacts.isEmpty) {
                    return _Empty(
                      isSearch: _query.isNotEmpty,
                      query: _searchCtrl.text,
                      onAdd: () => _openForm(),
                    );
                  }
                  return ListView.separated(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.only(top: 8, bottom: 24),
                    itemCount: contacts.length,
                    separatorBuilder: (_, __) => Divider(
                      height: 1,
                      indent: 76,
                      color: scheme.outlineVariant.withValues(alpha: 0.5),
                    ),
                    itemBuilder: (context, i) => _ContactTile(
                      contact: contacts[i],
                      onDial: widget.onDial,
                      onEdit: () => _openForm(existing: contacts[i]),
                      onDelete: () => _confirmDelete(contacts[i]),
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

class _ContactTile extends StatelessWidget {
  const _ContactTile({
    required this.contact,
    required this.onDial,
    required this.onEdit,
    required this.onDelete,
  });

  final Contact contact;
  final void Function(String) onDial;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final label = contact.name.isEmpty ? contact.extension : contact.name;
    return ListTile(
      onTap: () => onDial(contact.extension),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      leading: Stack(
        children: [
          InitialsAvatar(label: label, size: 44),
          if (contact.online)
            Positioned(
              right: 0,
              bottom: 0,
              child: Container(
                width: 12,
                height: 12,
                decoration: BoxDecoration(
                  color: AppColors.emeraldLight,
                  shape: BoxShape.circle,
                  border: Border.all(color: scheme.surface, width: 2),
                ),
              ),
            ),
        ],
      ),
      title: Text(
        label,
        style: const TextStyle(fontWeight: FontWeight.w600),
        overflow: TextOverflow.ellipsis,
      ),
      subtitle: Text(
        'Ext ${contact.extension}',
        style: TextStyle(fontSize: 12.5, color: scheme.onSurfaceVariant),
      ),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            icon: const Icon(Icons.call, color: AppColors.emerald),
            onPressed: () => onDial(contact.extension),
          ),
          PopupMenuButton<String>(
            icon: const Icon(Icons.more_vert),
            onSelected: (v) {
              if (v == 'edit') onEdit();
              if (v == 'delete') onDelete();
            },
            itemBuilder: (_) => const [
              PopupMenuItem(
                value: 'edit',
                child: ListTile(
                  leading: Icon(Icons.edit_outlined),
                  title: Text('Edit'),
                  contentPadding: EdgeInsets.zero,
                ),
              ),
              PopupMenuItem(
                value: 'delete',
                child: ListTile(
                  leading: Icon(Icons.delete_outline, color: AppColors.danger),
                  title: Text('Delete'),
                  contentPadding: EdgeInsets.zero,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Result of the add/edit form.
class _ContactDraft {
  const _ContactDraft({required this.name, required this.extension});
  final String name;
  final String extension;
}

class _ContactFormDialog extends StatefulWidget {
  const _ContactFormDialog({this.existing});
  final Contact? existing;

  @override
  State<_ContactFormDialog> createState() => _ContactFormDialogState();
}

class _ContactFormDialogState extends State<_ContactFormDialog> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _nameCtrl;
  late final TextEditingController _extCtrl;

  @override
  void initState() {
    super.initState();
    _nameCtrl = TextEditingController(text: widget.existing?.name ?? '');
    _extCtrl = TextEditingController(text: widget.existing?.extension ?? '');
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _extCtrl.dispose();
    super.dispose();
  }

  void _save() {
    if (!_formKey.currentState!.validate()) return;
    Navigator.pop(
      context,
      _ContactDraft(
        name: _nameCtrl.text.trim(),
        extension: _extCtrl.text.trim(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isEdit = widget.existing != null;
    return AlertDialog(
      title: Text(isEdit ? 'Edit contact' : 'Add contact'),
      content: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextFormField(
              controller: _nameCtrl,
              textCapitalization: TextCapitalization.words,
              textInputAction: TextInputAction.next,
              autofocus: true,
              decoration: const InputDecoration(
                labelText: 'Name',
                hintText: 'Jane Doe',
              ),
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Enter a name' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _extCtrl,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              textInputAction: TextInputAction.done,
              onFieldSubmitted: (_) => _save(),
              decoration: const InputDecoration(
                labelText: 'Extension',
                hintText: 'e.g. 1002',
              ),
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Enter an extension' : null,
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _save,
          child: Text(isEdit ? 'Save' : 'Add'),
        ),
      ],
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty(
      {required this.isSearch, required this.query, required this.onAdd});
  final bool isSearch;
  final String query;
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ListView(
      children: [
        const SizedBox(height: 96),
        Icon(Icons.contacts_outlined,
            size: 56, color: scheme.onSurfaceVariant.withValues(alpha: 0.4)),
        const SizedBox(height: 16),
        Text(
          isSearch ? 'No matches for "$query"' : 'No contacts yet',
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        ),
        if (!isSearch) ...[
          const SizedBox(height: 8),
          Text(
            'Add people you call often',
            textAlign: TextAlign.center,
            style: TextStyle(color: scheme.onSurfaceVariant),
          ),
          const SizedBox(height: 20),
          Center(
            child: FilledButton.tonalIcon(
              onPressed: onAdd,
              style: FilledButton.styleFrom(
                minimumSize: const Size(0, 44),
                padding: const EdgeInsets.symmetric(horizontal: 20),
              ),
              icon: const Icon(Icons.add, size: 18),
              label: const Text('Add contact'),
            ),
          ),
        ],
      ],
    );
  }
}
