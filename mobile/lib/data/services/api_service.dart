import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/note.dart';
import '../models/task.dart';
import 'storage_service.dart';

class ApiService {
  final StorageService _storage;

  ApiService({StorageService? storage}) : _storage = storage ?? StorageService();

  Future<Map<String, String>> _getHeaders() async {
    final token = await _storage.getDeviceToken();
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      if (token != null && token.isNotEmpty) ...{
        'x-muse-device-token': token,
        'Authorization': 'Bearer $token',
      },
    };
  }

  Future<String> _getBaseUrl() async {
    final url = await _storage.getServerUrl();
    if (url == null || url.isEmpty) {
      throw Exception('Server URL not configured. Please pair the device first.');
    }
    return url;
  }

  // --- Pairing ---
  Future<Map<String, dynamic>> claimPairing({
    required String serverUrl,
    required String? token,
    required String? pin,
    required String deviceName,
    required String deviceModel,
  }) async {
    final cleanUrl = serverUrl.trim().replaceAll(RegExp(r'/+$'), '');
    final endpoint = Uri.parse('$cleanUrl/api/remote/pairing/claim');

    final body = jsonEncode({
      if (token != null && token.isNotEmpty) 'token': token.trim(),
      if (pin != null && pin.isNotEmpty) 'pin': pin.trim(),
      'deviceName': deviceName,
      'deviceModel': deviceModel,
    });

    final response = await http
        .post(endpoint, headers: {'Content-Type': 'application/json'}, body: body)
        .timeout(const Duration(seconds: 10));

    if (response.statusCode >= 200 && response.statusCode < 300) {
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final deviceToken = data['deviceToken'] as String;
      final device = data['device'] as Map<String, dynamic>?;
      final deviceId = device?['id'] as String?;

      await _storage.saveConnection(
        serverUrl: cleanUrl,
        deviceToken: deviceToken,
        deviceName: deviceName,
        deviceId: deviceId,
      );

      return data;
    } else {
      final err = jsonDecode(response.body);
      throw Exception(err['error'] ?? 'Pairing failed (${response.statusCode})');
    }
  }

  // --- Notes ---
  Future<List<Note>> fetchNotes() async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/notes?scope=all');

    final response = await http.get(uri, headers: headers).timeout(const Duration(seconds: 10));
    if (response.statusCode == 200) {
      final List<dynamic> list = jsonDecode(response.body);
      return list.map((json) => Note.fromJson(json as Map<String, dynamic>)).toList();
    }
    throw Exception('Failed to load notes (${response.statusCode})');
  }

  Future<Note> createNote({required String title, required String content, List<String>? tags}) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/notes');

    final response = await http
        .post(
          uri,
          headers: headers,
          body: jsonEncode({'title': title, 'content': content, 'tags': tags ?? []}),
        )
        .timeout(const Duration(seconds: 10));

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return Note.fromJson(jsonDecode(response.body));
    }
    throw Exception('Failed to create note (${response.statusCode})');
  }

  Future<void> toggleFavoriteNote(String noteId, bool currentFavorite) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/notes/$noteId');

    await http
        .patch(uri, headers: headers, body: jsonEncode({'favorite': !currentFavorite}))
        .timeout(const Duration(seconds: 10));
  }

  // --- Tasks ---
  Future<List<TodoTask>> fetchTasks() async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/tasks');

    final response = await http.get(uri, headers: headers).timeout(const Duration(seconds: 10));
    if (response.statusCode == 200) {
      final List<dynamic> list = jsonDecode(response.body);
      return list.map((json) => TodoTask.fromJson(json as Map<String, dynamic>)).toList();
    }
    throw Exception('Failed to load tasks (${response.statusCode})');
  }

  Future<TodoTask> createTask({required String title, String? dueDate, String? priority}) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/tasks');

    final response = await http
        .post(
          uri,
          headers: headers,
          body: jsonEncode({
            'title': title,
            'dueDate': ?dueDate,
            'priority': ?priority,
          }),
        )
        .timeout(const Duration(seconds: 10));

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return TodoTask.fromJson(jsonDecode(response.body));
    }
    throw Exception('Failed to create task (${response.statusCode})');
  }

  Future<void> toggleTaskCompleted(String taskId, bool completed) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/tasks/$taskId');

    await http
        .patch(uri, headers: headers, body: jsonEncode({'completed': completed}))
        .timeout(const Duration(seconds: 10));
  }

  // --- Bip AI Chat ---
  Future<Map<String, dynamic>> sendChatMessage(String message, List<Map<String, String>> history) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/ai/chat');

    final response = await http
        .post(
          uri,
          headers: headers,
          body: jsonEncode({
            'message': message,
            'history': history,
          }),
        )
        .timeout(const Duration(seconds: 40));

    if (response.statusCode == 200) {
      return jsonDecode(response.body) as Map<String, dynamic>;
    }
    final err = jsonDecode(response.body);
    throw Exception(err['error'] ?? 'Bip AI error (${response.statusCode})');
  }

  // --- Health / Network Check ---
  Future<bool> checkConnection() async {
    try {
      final base = await _getBaseUrl();
      final uri = Uri.parse('$base/api/remote/network-info');
      final res = await http.get(uri).timeout(const Duration(seconds: 5));
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  // --- Usage / Status ---
  Future<Map<String, dynamic>> getUsage() async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/ai/usage');

    final response = await http.get(uri, headers: headers).timeout(const Duration(seconds: 10));
    if (response.statusCode == 200) {
      return jsonDecode(response.body) as Map<String, dynamic>;
    }
    return {};
  }
}
