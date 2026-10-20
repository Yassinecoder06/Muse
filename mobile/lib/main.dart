import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:quick_actions/quick_actions.dart';
import 'data/services/app_events.dart';
import 'data/services/device_timezone.dart';
import 'data/services/offline_queue.dart';
import 'data/services/reminder_service.dart';
import 'data/services/storage_service.dart';
import 'ui/theme/app_theme.dart';
import 'ui/views/main_scaffold.dart';
import 'ui/views/pairing_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: AppTheme.surface,
      systemNavigationBarIconBrightness: Brightness.light,
    ),
  );

  final storage = StorageService();
  final bool isPaired = await storage.isPaired();

  await DeviceTimezone.load();
  await OfflineQueue.init();
  await ReminderService.init();
  await AppTheme.initTheme();

  // Long-press the app icon: jump straight into capturing.
  const quickActions = QuickActions();
  quickActions.initialize((type) => AppEvents.launchAction.value = type);
  quickActions.setShortcutItems(const [
    ShortcutItem(type: 'voice_note', localizedTitle: 'Voice note'),
    ShortcutItem(type: 'new_note', localizedTitle: 'Quick note'),
    ShortcutItem(type: 'ask_bip', localizedTitle: 'Ask Bip'),
  ]);

  runApp(MuseMobileApp(initialPaired: isPaired));
}

class MuseMobileApp extends StatefulWidget {
  final bool initialPaired;

  const MuseMobileApp({super.key, required this.initialPaired});

  @override
  State<MuseMobileApp> createState() => _MuseMobileAppState();
}

class _MuseMobileAppState extends State<MuseMobileApp> {
  final _navigatorKey = GlobalKey<NavigatorState>();
  final _messengerKey = GlobalKey<ScaffoldMessengerState>();

  @override
  void initState() {
    super.initState();
    AppEvents.deviceUnpaired.addListener(_onDeviceUnpaired);
  }

  @override
  void dispose() {
    AppEvents.deviceUnpaired.removeListener(_onDeviceUnpaired);
    super.dispose();
  }

  // The desktop revoked this phone: drop the dead credentials and go back to
  // pairing instead of leaving every tab showing request errors.
  Future<void> _onDeviceUnpaired() async {
    if (!AppEvents.deviceUnpaired.value) return;
    await StorageService().clear();
    AppEvents.deviceUnpaired.value = false;
    _navigatorKey.currentState?.pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const PairingScreen()),
      (route) => false,
    );
    _messengerKey.currentState?.showSnackBar(
      const SnackBar(content: Text('This phone was unpaired from Muse desktop. Scan a new code to reconnect.')),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<ThemeMode>(
      valueListenable: AppTheme.themeNotifier,
      builder: (context, currentMode, _) {
        return MaterialApp(
          title: 'Muse Companion',
          debugShowCheckedModeBanner: false,
          navigatorKey: _navigatorKey,
          scaffoldMessengerKey: _messengerKey,
          theme: AppTheme.lightTheme,
          darkTheme: AppTheme.darkTheme,
          themeMode: currentMode,
          home: widget.initialPaired ? const MainScaffold() : const PairingScreen(),
        );
      },
    );
  }
}
