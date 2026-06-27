import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'src/services/api_client.dart';
import 'src/services/auth_service.dart';
import 'src/services/callkit_service.dart';
import 'src/services/directory_service.dart';
import 'src/services/phone_service.dart';
import 'src/services/push_service.dart';
import 'src/services/settings_service.dart';
import 'src/services/token_store.dart';
import 'src/services/tone_service.dart';
import 'src/state/session_controller.dart';
import 'src/ui/call_screen.dart';
import 'src/ui/home_screen.dart';
import 'src/ui/login_screen.dart';
import 'src/ui/splash_screen.dart';
import 'src/ui/theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final tokens = TokenStore();
  final api = ApiClient(tokens);
  final auth = AuthService(api, tokens);
  final directory = DirectoryService(api);
  final settings = SettingsService(api);
  final tones = ToneService();
  final phone = PhoneService();
  final callkit = CallKitService();
  final push = PushService(api);

  final session = SessionController(
    auth: auth,
    phone: phone,
    callkit: callkit,
    push: push,
  );

  // Push is best-effort: if Firebase isn't configured yet the app still runs
  // (outgoing + foreground calls work; only background wake needs Firebase).
  try {
    await push.init();
  } catch (_) {}

  runApp(EnjoysVoiceApp(
    session: session,
    phone: phone,
    directory: directory,
    settings: settings,
    tones: tones,
  ));
}

class EnjoysVoiceApp extends StatelessWidget {
  const EnjoysVoiceApp({
    super.key,
    required this.session,
    required this.phone,
    required this.directory,
    required this.settings,
    required this.tones,
  });

  final SessionController session;
  final PhoneService phone;
  final DirectoryService directory;
  final SettingsService settings;
  final ToneService tones;

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: session),
        ChangeNotifierProvider.value(value: phone),
        ChangeNotifierProvider.value(value: settings),
        Provider.value(value: directory),
        Provider.value(value: tones),
      ],
      child: MaterialApp(
        title: 'Enjoys Voice',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.light,
        darkTheme: AppTheme.dark,
        themeMode: ThemeMode.system,
        home: const _Root(),
      ),
    );
  }
}

class _Root extends StatefulWidget {
  const _Root();

  @override
  State<_Root> createState() => _RootState();
}

class _RootState extends State<_Root> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<SessionController>().bootstrap();
    });
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<SessionController>();
    final phone = context.watch<PhoneService>();

    // An active call always takes over the screen, regardless of auth screen.
    if (phone.active != null) {
      return const CallScreen();
    }

    switch (session.status) {
      case AuthStatus.unknown:
        return const SplashScreen();
      case AuthStatus.loggedOut:
        return const LoginScreen();
      case AuthStatus.loggedIn:
        return const HomeScreen();
    }
  }
}
