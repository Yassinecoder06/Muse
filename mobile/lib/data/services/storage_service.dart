import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

class StorageService {
  static const _keyServerUrl = 'muse_server_url';
  static const _keyDeviceToken = 'muse_device_token';
  static const _keyDeviceName = 'muse_device_name';
  static const _keyDeviceId = 'muse_device_id';

  // The device token is a long-lived credential for the whole Muse account, so
  // it lives in the Android Keystore / iOS Keychain rather than plain prefs.
  static const _secure = FlutterSecureStorage();

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
    await _secure.write(key: _keyDeviceToken, value: deviceToken.trim());
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
    final token = await _secure.read(key: _keyDeviceToken);
    if (token != null && token.isNotEmpty) return token;

    // One-time move for phones paired before tokens were stored securely.
    final prefs = await SharedPreferences.getInstance();
    final legacy = prefs.getString(_keyDeviceToken);
    if (legacy != null && legacy.isNotEmpty) {
      await _secure.write(key: _keyDeviceToken, value: legacy);
      await prefs.remove(_keyDeviceToken);
    }
    return legacy;
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
    await _secure.delete(key: _keyDeviceToken);
    await prefs.remove(_keyDeviceName);
    await prefs.remove(_keyDeviceId);
  }
}
