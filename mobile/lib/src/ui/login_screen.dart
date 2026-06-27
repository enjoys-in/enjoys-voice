import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../state/session_controller.dart';
import 'widgets/brand_mark.dart';

enum _AuthMode { password, otp, signup }

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _userCtrl = TextEditingController();
  final _passCtrl = TextEditingController();
  final _nameCtrl = TextEditingController();
  final _mobileCtrl = TextEditingController();
  final _codeCtrl = TextEditingController();

  _AuthMode _mode = _AuthMode.password;
  bool _obscure = true;
  bool _otpSent = false; // OTP & signup: has a code been requested yet?

  @override
  void dispose() {
    _userCtrl.dispose();
    _passCtrl.dispose();
    _nameCtrl.dispose();
    _mobileCtrl.dispose();
    _codeCtrl.dispose();
    super.dispose();
  }

  SessionController get _session => context.read<SessionController>();

  void _switchMode(_AuthMode mode) {
    if (_mode == mode) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _mode = mode;
      _otpSent = false;
    });
  }

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    final session = _session;

    switch (_mode) {
      case _AuthMode.password:
        final ok = await session.login(_userCtrl.text, _passCtrl.text);
        if (!ok) _toast(session.errorMessage ?? 'Login failed');
        break;

      case _AuthMode.otp:
        if (!_otpSent) {
          final ok = await session.requestOtp(_mobileCtrl.text, 'login');
          if (ok) {
            setState(() => _otpSent = true);
            _toast('Verification code sent');
          } else {
            _toast(session.errorMessage ?? 'Could not send code');
          }
        } else {
          final ok = await session.loginOtp(_mobileCtrl.text, _codeCtrl.text);
          if (!ok) _toast(session.errorMessage ?? 'Invalid code');
        }
        break;

      case _AuthMode.signup:
        if (!_otpSent) {
          final ok = await session.requestOtp(_mobileCtrl.text, 'signup');
          if (ok) {
            setState(() => _otpSent = true);
            _toast('Verification code sent');
          } else {
            _toast(session.errorMessage ?? 'Could not send code');
          }
        } else {
          final ok = await session.signupVerify(
            name: _nameCtrl.text,
            mobile: _mobileCtrl.text,
            password: _passCtrl.text,
            code: _codeCtrl.text,
          );
          if (!ok) _toast(session.errorMessage ?? 'Sign up failed');
        }
        break;
    }
  }

  String get _ctaLabel {
    switch (_mode) {
      case _AuthMode.password:
        return 'Sign in';
      case _AuthMode.otp:
        return _otpSent ? 'Verify & sign in' : 'Send code';
      case _AuthMode.signup:
        return _otpSent ? 'Verify & create account' : 'Send code';
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<SessionController>();
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Center(child: const BrandMark(size: 56)),
                  const SizedBox(height: 16),
                  Text(
                    'Enjoys Voice',
                    textAlign: TextAlign.center,
                    style: theme.textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.5,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Sign in to your extension',
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 24),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(20),
                      child: Form(
                        key: _formKey,
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            _ModeSwitcher(mode: _mode, onChanged: _switchMode),
                            const SizedBox(height: 20),
                            ..._fields(scheme),
                            const SizedBox(height: 20),
                            FilledButton(
                              onPressed: session.busy ? null : _submit,
                              child: session.busy
                                  ? const SizedBox(
                                      height: 20,
                                      width: 20,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                        color: Colors.white,
                                      ),
                                    )
                                  : Text(_ctaLabel),
                            ),
                            if (_otpSent && _mode != _AuthMode.password) ...[
                              const SizedBox(height: 8),
                              TextButton(
                                onPressed: session.busy
                                    ? null
                                    : () => setState(() => _otpSent = false),
                                child: const Text('Change number'),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  List<Widget> _fields(ColorScheme scheme) {
    switch (_mode) {
      case _AuthMode.password:
        return [
          _LabeledField(
            label: 'Extension or phone',
            child: TextFormField(
              controller: _userCtrl,
              autocorrect: false,
              enableSuggestions: false,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              textInputAction: TextInputAction.next,
              decoration: const InputDecoration(hintText: 'e.g. 1001'),
              validator: _required('Enter your extension'),
            ),
          ),
          const SizedBox(height: 16),
          _LabeledField(
            label: 'Password',
            child: _passwordField(),
          ),
        ];

      case _AuthMode.otp:
        return [
          _LabeledField(
            label: 'Phone number',
            child: _mobileField(enabled: !_otpSent),
          ),
          if (_otpSent) ...[
            const SizedBox(height: 16),
            _LabeledField(
              label: 'Verification code',
              child: _codeField(),
            ),
          ],
        ];

      case _AuthMode.signup:
        return [
          _LabeledField(
            label: 'Full name',
            child: TextFormField(
              controller: _nameCtrl,
              enabled: !_otpSent,
              textCapitalization: TextCapitalization.words,
              textInputAction: TextInputAction.next,
              decoration: const InputDecoration(hintText: 'Jane Doe'),
              validator: _required('Enter your name'),
            ),
          ),
          const SizedBox(height: 16),
          _LabeledField(
            label: 'Phone number',
            child: _mobileField(enabled: !_otpSent),
          ),
          const SizedBox(height: 16),
          _LabeledField(
            label: 'Password',
            child: _passwordField(enabled: !_otpSent),
          ),
          if (_otpSent) ...[
            const SizedBox(height: 16),
            _LabeledField(
              label: 'Verification code',
              child: _codeField(),
            ),
          ],
        ];
    }
  }

  Widget _passwordField({bool enabled = true}) => TextFormField(
        controller: _passCtrl,
        enabled: enabled,
        obscureText: _obscure,
        textInputAction: TextInputAction.done,
        onFieldSubmitted: (_) => _submit(),
        decoration: InputDecoration(
          hintText: '••••••••',
          suffixIcon: IconButton(
            icon: Icon(
              _obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined,
              size: 20,
            ),
            onPressed: () => setState(() => _obscure = !_obscure),
          ),
        ),
        validator: (v) => (v == null || v.length < 4) ? 'At least 4 characters' : null,
      );

  Widget _mobileField({required bool enabled}) => TextFormField(
        controller: _mobileCtrl,
        enabled: enabled,
        keyboardType: TextInputType.phone,
        textInputAction: TextInputAction.next,
        inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9+ ]'))],
        decoration: const InputDecoration(hintText: '+1 555 0100'),
        validator: (v) =>
            (v == null || v.trim().length < 6) ? 'Enter a valid number' : null,
      );

  Widget _codeField() => TextFormField(
        controller: _codeCtrl,
        keyboardType: TextInputType.number,
        textInputAction: TextInputAction.done,
        maxLength: 6,
        onFieldSubmitted: (_) => _submit(),
        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
        decoration: const InputDecoration(
          hintText: '000000',
          counterText: '',
        ),
        validator: (v) =>
            (v == null || v.trim().length < 4) ? 'Enter the code' : null,
      );

  String? Function(String?) _required(String msg) =>
      (v) => (v == null || v.trim().isEmpty) ? msg : null;
}

/// Segmented Password / OTP / Sign up switcher (mirrors the web tab control).
class _ModeSwitcher extends StatelessWidget {
  const _ModeSwitcher({required this.mode, required this.onChanged});

  final _AuthMode mode;
  final ValueChanged<_AuthMode> onChanged;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    Widget tab(_AuthMode m, String label) {
      final active = m == mode;
      return Expanded(
        child: GestureDetector(
          onTap: () => onChanged(m),
          behavior: HitTestBehavior.opaque,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 150),
            padding: const EdgeInsets.symmetric(vertical: 9),
            decoration: BoxDecoration(
              color: active ? scheme.surface : Colors.transparent,
              borderRadius: BorderRadius.circular(8),
              boxShadow: active
                  ? [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.08),
                        blurRadius: 4,
                        offset: const Offset(0, 1),
                      ),
                    ]
                  : null,
            ),
            child: Text(
              label,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 13,
                fontWeight: active ? FontWeight.w600 : FontWeight.w500,
                color: active ? scheme.onSurface : scheme.onSurfaceVariant,
              ),
            ),
          ),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          tab(_AuthMode.password, 'Password'),
          tab(_AuthMode.otp, 'OTP'),
          tab(_AuthMode.signup, 'Sign up'),
        ],
      ),
    );
  }
}

class _LabeledField extends StatelessWidget {
  const _LabeledField({required this.label, required this.child});

  final String label;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 2, bottom: 6),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w500,
              color: scheme.onSurface,
            ),
          ),
        ),
        child,
      ],
    );
  }
}
