import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

/// What decides whether Bip's alarms actually ring on this phone, with a way
/// to fix each. Xiaomi/HyperOS adds its own switches on top of Android's.
class AlarmSetup {
  AlarmSetup._();

  static const _system = MethodChannel('muse/system');
  static final _plugin = FlutterLocalNotificationsPlugin();

  static AndroidFlutterLocalNotificationsPlugin? get _android {
    try {
      return _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    } catch (_) {
      return null; // plugin not set up (tests, unsupported platform)
    }
  }

  static Future<T?> _call<T>(String method) async {
    try {
      return await _system.invokeMethod<T>(method);
    } catch (_) {
      return null; // not Android, or an older build without the bridge
    }
  }

  static Future<bool> isXiaomi() async {
    final maker = await _call<String>('manufacturer') ?? '';
    return const ['xiaomi', 'redmi', 'poco'].any(maker.contains);
  }

  static Future<AlarmStatus> check() async => AlarmStatus(
        notifications: await _android?.areNotificationsEnabled() ?? true,
        exactAlarms: await _android?.canScheduleExactNotifications() ?? true,
        fullScreen: await _call<bool>('canUseFullScreenIntent') ?? true,
        battery: await _call<bool>('isIgnoringBatteryOptimizations') ?? true,
        xiaomi: await isXiaomi(),
      );

  static Future<void> openNotificationSettings() async {
    final granted = await _android?.requestNotificationsPermission();
    if (granted != true) await _call<bool>('openNotificationSettings');
  }

  static Future<void> openExactAlarmSettings() async => _android?.requestExactAlarmsPermission();
  static Future<void> openFullScreenSettings() async => _call<bool>('openFullScreenIntentSettings');
  static Future<void> openBatterySettings() async => _call<bool>('requestIgnoreBatteryOptimizations');
  static Future<void> openXiaomiAutostart() async => _call<bool>('openXiaomiAutostart');
  static Future<void> openXiaomiPermissions() async => _call<bool>('openXiaomiPermissions');
}

class AlarmStatus {
  final bool notifications;
  final bool exactAlarms;
  final bool fullScreen;
  final bool battery;
  final bool xiaomi;

  const AlarmStatus({required this.notifications, required this.exactAlarms, required this.fullScreen, required this.battery, required this.xiaomi});

  /// Everything Android lets us read is fine (Xiaomi's own switches can't be read).
  bool get ready => notifications && exactAlarms && fullScreen && battery;
}
