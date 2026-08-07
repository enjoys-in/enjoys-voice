import 'package:flutter/material.dart';

import '../theme.dart';

/// Enjoys Voice brand mark — a gradient squircle holding a phone handset, kept
/// visually in step with the web `BrandMark` / app icon.
class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.size = 48, this.radius});

  final double size;
  final double? radius;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        gradient: AppColors.brandGradient,
        borderRadius: BorderRadius.circular(radius ?? size * 0.28),
        boxShadow: [
          BoxShadow(
            color: AppColors.brandStart.withValues(alpha: 0.35),
            blurRadius: size * 0.3,
            offset: Offset(0, size * 0.12),
          ),
        ],
      ),
      child: Icon(
        Icons.phone_in_talk_rounded,
        size: size * 0.52,
        color: Colors.white,
      ),
    );
  }
}
