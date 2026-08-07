import 'package:flutter/material.dart';
import 'package:sip_ua/sip_ua.dart';

import '../theme.dart';

/// Small pill that reflects the SIP registration state (Online / Connecting…).
class PresenceBadge extends StatelessWidget {
  const PresenceBadge({super.key, required this.state});

  final RegistrationStateEnum? state;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final registered = state == RegistrationStateEnum.REGISTERED;
    final color = registered ? AppColors.emeraldLight : AppColors.amber;
    final label = registered ? 'Online' : 'Connecting';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 7,
            height: 7,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: scheme.onSurface,
            ),
          ),
        ],
      ),
    );
  }
}
