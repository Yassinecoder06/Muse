import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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

  runApp(MuseMobileApp(initialPaired: isPaired));
}

class MuseMobileApp extends StatelessWidget {
  final bool initialPaired;

  const MuseMobileApp({super.key, required this.initialPaired});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Muse Companion',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.darkTheme,
      home: initialPaired ? const MainScaffold() : const PairingScreen(),
    );
  }
}
