import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/note.dart';
import '../models/task.dart';
import '../models/event.dart';
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
  Future<List<Note>> fetchNotes({String scope = 'all'}) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/notes?scope=$scope');

    final response = await http.get(uri, headers: headers).timeout(const Duration(seconds: 10));
    if (response.statusCode == 200) {
      final List<dynamic> list = jsonDecode(response.body);
      return list.map((json) => Note.fromJson(json as Map<String, dynamic>)).toList();
    }
    throw Exception('Failed to load notes (${response.statusCode})');
  }

  Future<Note> fetchNote(String noteId) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/notes/$noteId');

    final response = await http.get(uri, headers: headers).timeout(const Duration(seconds: 10));
    if (response.statusCode == 200) {
      return Note.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
    }
    throw Exception('Failed to load note ($noteId)');
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

  Future<Note> updateNote(
    String noteId, {
    String? title,
    String? content,
    List<String>? tags,
    bool? favorite,
  }) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/notes/$noteId');

    final payload = <String, dynamic>{
      'title': ?title,
      'content': ?content,
      'tags': ?tags,
      'favorite': ?favorite,
    };

    final response = await http
        .put(uri, headers: headers, body: jsonEncode(payload))
        .timeout(const Duration(seconds: 10));

    if (response.statusCode == 200) {
      return Note.fromJson(jsonDecode(response.body));
    }
    throw Exception('Failed to update note (${response.statusCode})');
  }

  Future<void> toggleFavoriteNote(String noteId, bool currentFavorite) async {
    await updateNote(noteId, favorite: !currentFavorite);
  }

  Future<void> deleteNote(String noteId) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/notes/$noteId');

    final response = await http.delete(uri, headers: headers).timeout(const Duration(seconds: 10));
    if (response.statusCode != 204 && response.statusCode != 200) {
      throw Exception('Failed to delete note (${response.statusCode})');
    }
  }

  Future<void> restoreNote(String noteId) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/notes/$noteId/restore');

    final response = await http.post(uri, headers: headers).timeout(const Duration(seconds: 10));
    if (response.statusCode != 200 && response.statusCode != 204) {
      throw Exception('Failed to restore note (${response.statusCode})');
    }
  }

  Future<void> deleteNotePermanently(String noteId) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/notes/$noteId/permanent');

    final response = await http.delete(uri, headers: headers).timeout(const Duration(seconds: 10));
    if (response.statusCode != 204 && response.statusCode != 200) {
      throw Exception('Failed to permanently delete note (${response.statusCode})');
    }
  }

  Future<void> emptyTrash() async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/notes/trash');

    final response = await http.delete(uri, headers: headers).timeout(const Duration(seconds: 10));
    if (response.statusCode != 204 && response.statusCode != 200) {
      throw Exception('Failed to empty trash (${response.statusCode})');
    }
  }

  // --- Tasks ---
  Future<List<TodoTask>> fetchTasks({String? dueDate}) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = dueDate != null && dueDate.isNotEmpty
        ? Uri.parse('$base/api/tasks?due_date=$dueDate')
        : Uri.parse('$base/api/tasks');

    final response = await http.get(uri, headers: headers).timeout(const Duration(seconds: 10));
    if (response.statusCode == 200) {
      final List<dynamic> list = jsonDecode(response.body);
      return list.map((json) => TodoTask.fromJson(json as Map<String, dynamic>)).toList();
    }
    throw Exception('Failed to load tasks (${response.statusCode})');
  }

  Future<TodoTask> createTask({
    required String title,
    String? dueDate,
    String? dueTime,
    String priority = 'medium',
    String? noteId,
  }) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/tasks');

    final payload = {
      'text': title,
      'completed': false,
      if (dueDate != null && dueDate.isNotEmpty) 'due_date': dueDate,
      if (dueTime != null && dueTime.isNotEmpty) 'due_time': dueTime,
      'priority': priority.toLowerCase(),
      'note_id': ?noteId,
    };

    final response = await http
        .post(uri, headers: headers, body: jsonEncode(payload))
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

  Future<void> deleteTask(String taskId) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/tasks/$taskId');

    final response = await http.delete(uri, headers: headers).timeout(const Duration(seconds: 10));
    if (response.statusCode != 204 && response.statusCode != 200) {
      throw Exception('Failed to delete task (${response.statusCode})');
    }
  }

  // --- Calendar Events ---
  Future<List<CalendarEvent>> fetchEvents({DateTime? from, DateTime? to}) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();

    final queryParams = <String, String>{};
    if (from != null) queryParams['from'] = from.toIso8601String();
    if (to != null) queryParams['to'] = to.toIso8601String();

    final uri = Uri.parse('$base/api/calendar/events').replace(
      queryParameters: queryParams.isNotEmpty ? queryParams : null,
    );

    final response = await http.get(uri, headers: headers).timeout(const Duration(seconds: 10));
    if (response.statusCode == 200) {
      final List<dynamic> list = jsonDecode(response.body);
      return list.map((json) => CalendarEvent.fromJson(json as Map<String, dynamic>)).toList();
    }
    throw Exception('Failed to load events (${response.statusCode})');
  }

  Future<CalendarEvent> createEvent({
    required String title,
    String description = '',
    required DateTime startTime,
    DateTime? endTime,
    bool allDay = false,
    String location = '',
    String? noteId,
  }) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/calendar/events');

    final payload = {
      'title': title,
      'description': description,
      'start_time': startTime.toIso8601String(),
      if (endTime != null) 'end_time': endTime.toIso8601String(),
      'all_day': allDay,
      'location': location,
      'note_id': ?noteId,
    };

    final response = await http
        .post(uri, headers: headers, body: jsonEncode(payload))
        .timeout(const Duration(seconds: 10));

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return CalendarEvent.fromJson(jsonDecode(response.body));
    }
    throw Exception('Failed to create event (${response.statusCode})');
  }

  Future<CalendarEvent> quickAddEvent(String prompt) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/calendar/events/quick-add');

    final payload = {
      'prompt': prompt,
      'clientDate': DateTime.now().toIso8601String(),
    };

    final response = await http
        .post(uri, headers: headers, body: jsonEncode(payload))
        .timeout(const Duration(seconds: 15));

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return CalendarEvent.fromJson(jsonDecode(response.body));
    }
    throw Exception('Failed to quick add event (${response.statusCode})');
  }

  Future<void> deleteEvent(String eventId) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/calendar/events/$eventId');

    final response = await http.delete(uri, headers: headers).timeout(const Duration(seconds: 10));
    if (response.statusCode != 204 && response.statusCode != 200) {
      throw Exception('Failed to delete event (${response.statusCode})');
    }
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
    try {
      final err = jsonDecode(response.body);
      throw Exception(err['error'] ?? 'Bip AI error (${response.statusCode})');
    } catch (e) {
      if (e is Exception && !e.toString().contains('FormatException')) rethrow;
      throw Exception('Server error (${response.statusCode})');
    }
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
