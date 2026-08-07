import 'package:flutter/material.dart';

import 'screens/contacts_screen.dart';
import 'screens/keypad_screen.dart';
import 'screens/recents_screen.dart';
import 'screens/settings_screen.dart';

/// Authenticated app shell: a bottom-nav host over the Keypad, Recents,
/// Contacts and Settings tabs.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  static const _keypadIndex = 0;

  int _index = _keypadIndex;
  final _dialCtrl = TextEditingController();

  @override
  void dispose() {
    _dialCtrl.dispose();
    super.dispose();
  }

  /// Pre-fill the dialer with [number] and jump to the keypad tab.
  void _dial(String number) {
    _dialCtrl.text = number;
    _dialCtrl.selection =
        TextSelection.fromPosition(TextPosition(offset: _dialCtrl.text.length));
    setState(() => _index = _keypadIndex);
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final tabs = <Widget>[
      KeypadScreen(controller: _dialCtrl),
      RecentsScreen(onDial: _dial, active: _index == 1),
      ContactsScreen(onDial: _dial),
      const SettingsScreen(),
    ];

    return Scaffold(
      body: IndexedStack(index: _index, children: tabs),
      bottomNavigationBar: NavigationBarTheme(
        data: NavigationBarThemeData(
          backgroundColor: scheme.surface,
          indicatorColor: scheme.primary.withValues(alpha: 0.12),
          labelTextStyle: WidgetStateProperty.resolveWith(
            (states) => TextStyle(
              fontSize: 11,
              fontWeight: states.contains(WidgetState.selected)
                  ? FontWeight.w600
                  : FontWeight.w500,
              color: states.contains(WidgetState.selected)
                  ? scheme.primary
                  : scheme.onSurfaceVariant,
            ),
          ),
        ),
        child: NavigationBar(
          height: 64,
          selectedIndex: _index,
          onDestinationSelected: (i) => setState(() => _index = i),
          destinations: [
            NavigationDestination(
              icon: const Icon(Icons.dialpad_outlined),
              selectedIcon: Icon(Icons.dialpad, color: scheme.primary),
              label: 'Keypad',
            ),
            NavigationDestination(
              icon: const Icon(Icons.history_outlined),
              selectedIcon: Icon(Icons.history, color: scheme.primary),
              label: 'Recents',
            ),
            NavigationDestination(
              icon: const Icon(Icons.contacts_outlined),
              selectedIcon: Icon(Icons.contacts, color: scheme.primary),
              label: 'Contacts',
            ),
            NavigationDestination(
              icon: const Icon(Icons.settings_outlined),
              selectedIcon: Icon(Icons.settings, color: scheme.primary),
              label: 'Settings',
            ),
          ],
        ),
      ),
    );
  }
}
