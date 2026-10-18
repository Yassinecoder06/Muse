import 'package:shared_preferences/shared_preferences.dart';

class StorageService {
  static const _keyServerUrl = 'muse_server_url';
  static const _keyDeviceToken = 'muse_device_token';
  static const _keyDeviceName = 'muse_device_name';
  static const _keyDeviceId = 'muse_device_id';

  Future<void> saveConnection({
    required String serverUrl,
    required String deviceToken,
    required String deviceName,
    String? deviceId,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    // Normalize url: remove trailing slash
    final cleanUrl = serverUrl.trim().replaceAll(RegExp(r'/+$'), '');
    await prefs.setString(_keyServerUrl, cleanUrl);
    await prefs.setString(_keyDeviceToken, deviceToken.trim());
    await prefs.setString(_keyDeviceName, deviceName.trim());
    if (deviceId != null) {
      await prefs.setString(_keyDeviceId, deviceId);
    }
  }

  Future<String?> getServerUrl() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_keyServerUrl);
  }

  Future<String?> getDeviceToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_keyDeviceToken);
  }

  Future<String?> getDeviceName() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_keyDeviceName);
  }

  Future<bool> isPaired() async {
    final url = await getServerUrl();
    final token = await getDeviceToken();
    return url != null && url.isNotEmpty && token != null && token.isNotEmpty;
  }

  Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_keyServerUrl);
    await prefs.remove(_keyDeviceToken);
    await prefs.remove(_keyDeviceName);
    await prefs.remove(_keyDeviceId);
  }
}
