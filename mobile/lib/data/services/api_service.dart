import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/foundation.dart' show visibleForTesting;
import 'package:http/http.dart' as http;
import '../models/note.dart';
import '../models/task.dart';
import '../models/event.dart';
import 'app_events.dart';
import 'device_timezone.dart';
import 'storage_service.dart';

/// Every request goes through this client so a revoked device token (401 on a
/// request that carried one) sends the app back to pairing from anywhere.
class _AuthAwareClient extends http.BaseClient {
  final http.Client _inner = http.Client();

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final response = await _inner.send(request);
    if (response.statusCode == 401 && request.headers.containsKey('x-muse-device-token')) {
      AppEvents.deviceUnpaired.value = true;
    }
    return response;
  }
}

final _http = _AuthAwareClient();

class ApiService {
  final StorageService _storage;

  /// Screens create `ApiService()` directly; tests set this to render them
  /// with fake data.
  @visibleForTesting
  static ApiService? testOverride;

  factory ApiService({StorageService? storage}) => testOverride ?? ApiService.base(storage: storage);

  ApiService.base({StorageService? storage}) : _storage = storage ?? StorageService();

  /// Headers for loading protected resources such as note images.
  Future<Map<String, String>> authHeaders() => _getHeaders();

  /// Turns a server-relative path like `/api/images/ID` into a full URL.
  Future<String> resolveUrl(String pathOrUrl) async {
    if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://') || pathOrUrl.startsWith('data:')) {
      return pathOrUrl;
    }
    final base = await _getBaseUrl();
    return '$base${pathOrUrl.startsWith('/') ? '' : '/'}$pathOrUrl';
  }

  Future<Map<String, String>> _getHeaders() async {
    final token = await _storage.getDeviceToken();
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      // Bip and quick-add resolve "tomorrow at 8pm" in this zone.
      if (DeviceTimezone.id != null) 'x-muse-timezone': DeviceTimezone.id!,
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

    final response = await _http
        .post(endpoint, headers: {'Content-Type': 'application/json'}, body: body)
        .timeout(const Duration(seconds: 10));

    if (response.statusCode >= 200 && response.statusCode < 300) {
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final deviceToken = data['deviceToken'] as String;
      final deviceId = data['deviceId'] as String?;

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

    final response = await _http.get(uri, headers: headers).timeout(const Duration(seconds: 10));
    if (response.statusCode == 200) {
      final List<dynamic> list = jsonDecode(response.body);
      return list.map((json) => Note.fromJson(json as Map<String, dynamic>)).toList();
    }
    throw Exception('Failed to load notes (${response.statusCode})');
  }

  /// Keyword + meaning-based search across active notes (server-ranked).
  Future<List<Note>> searchNotes(String query) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/notes/search').replace(queryParameters: {'q': query});

    final response = await _http.get(uri, headers: headers).timeout(const Duration(seconds: 15));
    if (response.statusCode == 200) {
      final List<dynamic> list = jsonDecode(response.body);
      return list.map((json) => Note.fromJson(json as Map<String, dynamic>)).toList();
    }
    throw Exception('Search failed (${response.statusCode})');
  }

  /// Uploads an image and returns its server path (e.g. `/api/images/ID`).
  Future<String> uploadImage(Uint8List bytes, String mimeType) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    headers['Content-Type'] = mimeType;

    final response = await _http
        .post(Uri.parse('$base/api/uploads'), headers: headers, body: bytes)
        .timeout(const Duration(seconds: 30));
    if (response.statusCode == 201 || response.statusCode == 200) {
      return (jsonDecode(response.body) as Map<String, dynamic>)['url'] as String;
    }
    String message = 'Image upload failed (${response.statusCode})';
    try {
      message = (jsonDecode(response.body) as Map<String, dynamic>)['error']?.toString() ?? message;
    } catch (_) {}
    throw Exception(message);
  }

  Future<Note> fetchNote(String noteId) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/notes/$noteId');

    final response = await _http.get(uri, headers: headers).timeout(const Duration(seconds: 10));
    if (response.statusCode == 200) {
      return Note.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
    }
    throw Exception('Failed to load note ($noteId)');
  }

  Future<Note> createNote({required String title, required String content, List<String>? tags}) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/notes');

    final response = await _http
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

    final response = await _http
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

    final response = await _http.delete(uri, headers: headers).timeout(const Duration(seconds: 10));
    if (response.statusCode != 204 && response.statusCode != 200) {
      throw Exception('Failed to delete note (${response.statusCode})');
    }
  }

  Future<void> restoreNote(String noteId) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/notes/$noteId/restore');

    final response = await _http.post(uri, headers: headers).timeout(const Duration(seconds: 10));
    if (response.statusCode != 200 && response.statusCode != 204) {
      throw Exception('Failed to restore note (${response.statusCode})');
    }
  }

  Future<void> deleteNotePermanently(String noteId) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/notes/$noteId/permanent');

    final response = await _http.delete(uri, headers: headers).timeout(const Duration(seconds: 10));
    if (response.statusCode != 204 && response.statusCode != 200) {
      throw Exception('Failed to permanently delete note (${response.statusCode})');
    }
  }

  Future<void> emptyTrash() async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/notes/trash');

    final response = await _http.delete(uri, headers: headers).timeout(const Duration(seconds: 10));
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

    final response = await _http.get(uri, headers: headers).timeout(const Duration(seconds: 10));
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
    int? reminderMinutesBefore,
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
      'reminder_minutes_before': ?reminderMinutesBefore,
    };

    final response = await _http
        .post(uri, headers: headers, body: jsonEncode(payload))
        .timeout(const Duration(seconds: 10));

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return TodoTask.fromJson(jsonDecode(response.body));
    }
    throw Exception('Failed to create task (${response.statusCode})');
  }

  /// Sets or clears a task's reminder (and optionally its due date/time).
  /// Pass `minutesBefore` for "N minutes before", or `at` for an exact time.
  Future<TodoTask> updateTaskReminder(
    String taskId, {
    String? dueDate,
    String? dueTime,
    bool clearDueTime = false,
    int? minutesBefore,
    DateTime? at,
    bool clear = false,
  }) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final payload = <String, dynamic>{
      'due_date': ?dueDate,
      if (dueTime != null || clearDueTime) 'due_time': dueTime,
      if (clear) ...{'reminder_minutes_before': null, 'reminder_at': null},
      if (!clear && minutesBefore != null) 'reminder_minutes_before': minutesBefore,
      if (!clear && at != null) 'reminder_at': at.toUtc().toIso8601String(),
    };
    final response = await _http
        .patch(Uri.parse('$base/api/tasks/$taskId'), headers: headers, body: jsonEncode(payload))
        .timeout(const Duration(seconds: 10));
    if (response.statusCode == 200) return TodoTask.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
    String message = 'Could not save the reminder (${response.statusCode})';
    try {
      message = (jsonDecode(response.body) as Map<String, dynamic>)['error']?.toString() ?? message;
    } catch (_) {}
    throw Exception(message);
  }

  Future<void> toggleTaskCompleted(String taskId, bool completed) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/tasks/$taskId');

    final response = await _http
        .patch(uri, headers: headers, body: jsonEncode({'completed': completed}))
        .timeout(const Duration(seconds: 10));
    if (response.statusCode != 200) {
      throw Exception('Failed to update task (${response.statusCode})');
    }
  }

  Future<void> deleteTask(String taskId) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/tasks/$taskId');

    final response = await _http.delete(uri, headers: headers).timeout(const Duration(seconds: 10));
    if (response.statusCode != 204 && response.statusCode != 200) {
      throw Exception('Failed to delete task (${response.statusCode})');
    }
  }

  // --- Calendar Events ---
  Future<List<CalendarEvent>> fetchEvents({DateTime? from, DateTime? to}) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();

    final queryParams = <String, String>{};
    if (from != null) queryParams['from'] = from.toUtc().toIso8601String();
    if (to != null) queryParams['to'] = to.toUtc().toIso8601String();

    final uri = Uri.parse('$base/api/calendar/events').replace(
      queryParameters: queryParams.isNotEmpty ? queryParams : null,
    );

    final response = await _http.get(uri, headers: headers).timeout(const Duration(seconds: 10));
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
      // Local DateTimes serialize without an offset, which the server rejects.
      'start_time': startTime.toUtc().toIso8601String(),
      if (endTime != null) 'end_time': endTime.toUtc().toIso8601String(),
      'all_day': allDay,
      'location': location,
      'note_id': ?noteId,
    };

    final response = await _http
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
      'clientDate': DateTime.now().toUtc().toIso8601String(),
    };

    final response = await _http
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

    final response = await _http.delete(uri, headers: headers).timeout(const Duration(seconds: 10));
    if (response.statusCode != 204 && response.statusCode != 200) {
      throw Exception('Failed to delete event (${response.statusCode})');
    }
  }

  // --- Bip AI Chat ---
  Future<Map<String, dynamic>> sendChatMessage(String message, {String? sessionId}) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/ai/chat');

    final response = await _http
        .post(
          uri,
          headers: headers,
          body: jsonEncode({
            'message': message,
            'sessionId': ?sessionId,
          }),
        )
        // Bip may run several tool rounds against slow models.
        .timeout(const Duration(seconds: 90));

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

  /// The most recent phone conversation with its messages, or null if none.
  Future<Map<String, dynamic>?> fetchLatestMobileSession() async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final listRes = await _http.get(Uri.parse('$base/api/chat/sessions'), headers: headers).timeout(const Duration(seconds: 10));
    if (listRes.statusCode != 200) throw Exception('Failed to load conversations (${listRes.statusCode})');
    final sessions = (jsonDecode(listRes.body) as List<dynamic>).whereType<Map<String, dynamic>>();
    final mobile = sessions.where((s) => s['context_type'] == 'mobile').toList();
    if (mobile.isEmpty) return null;

    final id = mobile.first['id'];
    final res = await _http.get(Uri.parse('$base/api/chat/sessions/$id'), headers: headers).timeout(const Duration(seconds: 10));
    if (res.statusCode != 200) throw Exception('Failed to load conversation (${res.statusCode})');
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  /// Starts a fresh phone conversation and returns its id.
  Future<String> createMobileSession() async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final res = await _http
        .post(Uri.parse('$base/api/chat/sessions'), headers: headers, body: jsonEncode({'title': 'Mobile Companion', 'context_type': 'mobile'}))
        .timeout(const Duration(seconds: 10));
    if (res.statusCode != 201 && res.statusCode != 200) throw Exception('Failed to start a new chat (${res.statusCode})');
    return (jsonDecode(res.body) as Map<String, dynamic>)['id'] as String;
  }

  // Runs a deletion Bip proposed, after the user taps Confirm on its card.
  Future<void> confirmAgentAction(String token) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/agent/confirm');

    final response = await _http
        .post(uri, headers: headers, body: jsonEncode({'token': token}))
        .timeout(const Duration(seconds: 15));
    if (response.statusCode == 200) return;
    String message = 'Could not complete this action (${response.statusCode})';
    try {
      final err = jsonDecode(response.body);
      if (err is Map && err['error'] != null) message = err['error'].toString();
    } catch (_) {}
    throw Exception(message);
  }

  // --- Health / Network Check ---
  Future<bool> checkConnection() async {
    try {
      final base = await _getBaseUrl();
      final headers = await _getHeaders();
      // Authenticated on purpose: succeeds only while this device is still paired.
      final uri = Uri.parse('$base/api/auth/session');
      final res = await _http.get(uri, headers: headers).timeout(const Duration(seconds: 5));
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

    final response = await _http.get(uri, headers: headers).timeout(const Duration(seconds: 10));
    if (response.statusCode == 200) {
      return jsonDecode(response.body) as Map<String, dynamic>;
    }
    return {};
  }

  // --- Music Hub ---
  Future<List<Map<String, dynamic>>> fetchMusicSongs() async {
    try {
      final base = await _getBaseUrl();
      final headers = await _getHeaders();
      final uri = Uri.parse('$base/api/music/songs');
      final res = await _http.get(uri, headers: headers).timeout(const Duration(seconds: 10));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        final songs = data['songs'] as List<dynamic>? ?? [];
        return songs.map((e) => Map<String, dynamic>.from(e as Map)).toList();
      }
    } catch (_) {}
    return [];
  }

  Future<List<Map<String, dynamic>>> fetchMusicPlaylists() async {
    try {
      final base = await _getBaseUrl();
      final headers = await _getHeaders();
      final uri = Uri.parse('$base/api/music/playlists');
      final res = await _http.get(uri, headers: headers).timeout(const Duration(seconds: 10));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        final playlists = data['playlists'] as List<dynamic>? ?? [];
        return playlists.map((e) => Map<String, dynamic>.from(e as Map)).toList();
      }
    } catch (_) {}
    return [];
  }

  Future<Map<String, dynamic>> createMusicPlaylist(String name, {List<dynamic>? tracks}) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/music/playlists');
    final res = await _http.post(
      uri,
      headers: headers,
      body: jsonEncode({'name': name, 'tracks': tracks ?? []}),
    ).timeout(const Duration(seconds: 10));
    if (res.statusCode == 200) {
      return jsonDecode(res.body) as Map<String, dynamic>;
    }
    throw Exception('Failed to create playlist');
  }

  Future<void> deleteMusicPlaylist(String id) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/music/playlists/$id');
    await _http.delete(uri, headers: headers).timeout(const Duration(seconds: 10));
  }

  Future<List<Map<String, dynamic>>> fetchMusicTasks() async {
    try {
      final base = await _getBaseUrl();
      final headers = await _getHeaders();
      final uri = Uri.parse('$base/api/music/tasks');
      final res = await _http.get(uri, headers: headers).timeout(const Duration(seconds: 10));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        final tasks = data['tasks'] as List<dynamic>? ?? [];
        return tasks.map((e) => Map<String, dynamic>.from(e as Map)).toList();
      }
    } catch (_) {}
    return [];
  }

  Future<void> deleteMusicTask(String id) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/music/tasks/$id');
    await _http.delete(uri, headers: headers).timeout(const Duration(seconds: 10));
  }

  Future<Map<String, dynamic>> downloadMusic(List<Map<String, dynamic>> items) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/music/download');
    final res = await _http.post(
      uri,
      headers: headers,
      body: jsonEncode({'items': items}),
    ).timeout(const Duration(seconds: 15));
    if (res.statusCode == 200) {
      return jsonDecode(res.body) as Map<String, dynamic>;
    }
    throw Exception('Failed to schedule music download');
  }

  Future<void> deleteMusicSong(String filename) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/music/songs/${Uri.encodeComponent(filename)}');
    await _http.delete(uri, headers: headers).timeout(const Duration(seconds: 10));
  }

  // --- Templates & Specialized Notes ---
  Future<List<Map<String, dynamic>>> fetchTemplates() async {
    try {
      final base = await _getBaseUrl();
      final headers = await _getHeaders();
      final uri = Uri.parse('$base/api/templates');
      final res = await _http.get(uri, headers: headers).timeout(const Duration(seconds: 10));
      if (res.statusCode == 200) {
        final list = jsonDecode(res.body) as List<dynamic>? ?? [];
        return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
      }
    } catch (_) {}
    return [];
  }

  Future<Note> createSpecializedNote({
    required String title,
    required String category,
    required Map<String, String> fields,
    List<String>? tags,
  }) async {
    final base = await _getBaseUrl();
    final headers = await _getHeaders();
    final uri = Uri.parse('$base/api/notes');

    // Generate markdown structure mirroring web templates
    final buffer = StringBuffer();
    fields.forEach((k, v) {
      if (v.trim().isNotEmpty) {
        final label = k.replaceAllMapped(RegExp(r'([A-Z])'), (m) => ' ${m[1]}').trim();
        buffer.writeln('### ${label[0].toUpperCase()}${label.substring(1)}');
        buffer.writeln(v.trim());
        buffer.writeln();
      }
    });

    final res = await _http.post(
      uri,
      headers: headers,
      body: jsonEncode({
        'title': title.trim().isEmpty ? 'Specialized Note' : title.trim(),
        'content': buffer.toString().trim(),
        'tags': tags ?? [category],
        'kind': 'specialized',
        'category': category,
        'fields': fields,
      }),
    ).timeout(const Duration(seconds: 15));

    if (res.statusCode == 201 || res.statusCode == 200) {
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      final note = Note.fromJson(data);
      AppEvents.notifyDataChanged();
      return note;
    }
    throw Exception('Failed to create specialized note');
  }

  // --- Analytics Activity ---
  Future<Map<String, dynamic>> fetchAnalyticsActivity({int days = 30}) async {
    try {
      final base = await _getBaseUrl();
      final headers = await _getHeaders();
      final uri = Uri.parse('$base/api/analytics/activity?days=$days');
      final res = await _http.get(uri, headers: headers).timeout(const Duration(seconds: 10));
      if (res.statusCode == 200) {
        return jsonDecode(res.body) as Map<String, dynamic>;
      }
    } catch (_) {}
    return {'chats': [], 'ai': []};
  }
}
