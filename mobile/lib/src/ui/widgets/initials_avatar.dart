import 'package:flutter/material.dart';

import '../theme.dart';

/// Circular initials avatar with the brand gradient — used in Recents,
/// Contacts and the call screen.
class InitialsAvatar extends StatelessWidget {
  const InitialsAvatar({
    super.key,
    required this.label,
    this.size = 44,
    this.gradient = true,
  });

  final String label;
  final double size;
  final bool gradient;

  String get _initials {
    final cleaned = label.trim();
    if (cleaned.isEmpty) return '#';
    final parts = cleaned.split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.length == 1) {
      final p = parts.first;
      return (p.length >= 2 ? p.substring(0, 2) : p).toUpperCase();
    }
    return (parts.first[0] + parts.last[0]).toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDigits = RegExp(r'^[0-9+#*\s]+$').hasMatch(label.trim());
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: gradient && !isDigits ? AppColors.brandGradient : null,
        color: gradient && !isDigits ? null : scheme.surfaceContainerHighest,
      ),
      child: isDigits
          ? Icon(Icons.person, size: size * 0.5, color: scheme.onSurfaceVariant)
          : Text(
              _initials,
              style: TextStyle(
                fontSize: size * 0.36,
                fontWeight: FontWeight.w600,
                color: Colors.white,
              ),
            ),
    );
  }
}
