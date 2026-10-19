import 'package:flutter_timezone/flutter_timezone.dart';

/// The phone's IANA timezone (e.g. "Africa/Tunis"). Sent with every request so
/// Bip resolves "tomorrow at 8pm" in the user's zone, and used for reminders.
class DeviceTimezone {
  DeviceTimezone._();

  static String? id;

  static Future<String?> load() async {
    try {
      id = (await FlutterTimezone.getLocalTimezone()).identifier;
    } catch (_) {
      id = null;
    }
    return id;
  }
}
