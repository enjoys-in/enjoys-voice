import 'package:flutter/material.dart';

/// Brand palette mirrored from the web dialer (shadcn neutral theme + the
/// Enjoys Voice indigo→violet brand gradient).
class AppColors {
  AppColors._();

  // Brand gradient (matches BrandMark / app icon).
  static const Color brandStart = Color(0xFF6366F1); // indigo-500
  static const Color brandEnd = Color(0xFF8B5CF6); // violet-500

  // Call semantics.
  static const Color emerald = Color(0xFF059669); // emerald-600 (answer/call)
  static const Color emeraldLight = Color(0xFF10B981); // emerald-500 (status)
  static const Color danger = Color(0xFFDC2626); // red-600 (hang up)
  static const Color amber = Color(0xFFF59E0B); // amber-500 (ringing)

  static const LinearGradient brandGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [brandStart, brandEnd],
  );
}

/// Light + dark Material 3 themes built on pure-neutral surfaces (no tint), to
/// match the web's grayscale shadcn look, with the brand indigo as primary.
class AppTheme {
  AppTheme._();

  static ThemeData get light {
    const scheme = ColorScheme(
      brightness: Brightness.light,
      primary: AppColors.brandStart,
      onPrimary: Colors.white,
      secondary: AppColors.brandEnd,
      onSecondary: Colors.white,
      error: AppColors.danger,
      onError: Colors.white,
      surface: Color(0xFFFFFFFF),
      onSurface: Color(0xFF0A0A0A),
      surfaceContainerHighest: Color(0xFFF4F4F5), // muted
      onSurfaceVariant: Color(0xFF71717A), // muted-foreground
      outline: Color(0xFFD4D4D8),
      outlineVariant: Color(0xFFE4E4E7), // border
      surfaceContainer: Color(0xFFFAFAFA),
      surfaceContainerHigh: Color(0xFFF4F4F5),
    );
    return _base(scheme);
  }

  static ThemeData get dark {
    const scheme = ColorScheme(
      brightness: Brightness.dark,
      primary: AppColors.brandStart,
      onPrimary: Colors.white,
      secondary: AppColors.brandEnd,
      onSecondary: Colors.white,
      error: Color(0xFFF87171),
      onError: Color(0xFF0A0A0A),
      surface: Color(0xFF0A0A0A),
      onSurface: Color(0xFFFAFAFA),
      surfaceContainerHighest: Color(0xFF27272A), // muted
      onSurfaceVariant: Color(0xFFA1A1AA), // muted-foreground
      outline: Color(0xFF3F3F46),
      outlineVariant: Color(0x1AFFFFFF), // border (white 10%)
      surfaceContainer: Color(0xFF18181B),
      surfaceContainerHigh: Color(0xFF1F1F23),
    );
    return _base(scheme);
  }

  static ThemeData _base(ColorScheme scheme) {
    final radius = BorderRadius.circular(12);
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: scheme.surface,
      splashFactory: InkSparkle.splashFactory,
      appBarTheme: AppBarTheme(
        backgroundColor: scheme.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        centerTitle: false,
        foregroundColor: scheme.onSurface,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: OutlineInputBorder(borderRadius: radius, borderSide: BorderSide.none),
        enabledBorder: OutlineInputBorder(
          borderRadius: radius,
          borderSide: BorderSide(color: scheme.outlineVariant),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: radius,
          borderSide: BorderSide(color: scheme.primary, width: 1.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: radius,
          borderSide: BorderSide(color: scheme.error),
        ),
        hintStyle: TextStyle(color: scheme.onSurfaceVariant.withValues(alpha: 0.7)),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(50),
          shape: RoundedRectangleBorder(borderRadius: radius),
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
        ),
      ),
      cardTheme: CardThemeData(
        color: scheme.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: scheme.outlineVariant),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
      dividerTheme: DividerThemeData(color: scheme.outlineVariant, thickness: 1),
    );
  }
}
