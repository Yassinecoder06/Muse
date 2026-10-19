import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'api_service.dart';
import 'app_events.dart';

/// Captures made while Muse desktop is unreachable (out of Wi-Fi, laptop
/// asleep) are kept on the phone and replayed in order once it is reachable.
class OfflineQueue {
  OfflineQueue._();

  static const _key = 'muse_offline_queue';
  static final ValueNotifier<int> pending = ValueNotifier<int>(0);
  static bool _flushing = false;

  static bool isNetworkError(Object error) =>
      error is SocketException || error is TimeoutException || error is http.ClientException || error is HandshakeException;

  static Future<List<Map<String, dynamic>>> _read() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key);
    if (raw == null || raw.isEmpty) return [];
    try {
      return (jsonDecode(raw) as List<dynamic>).whereType<Map<String, dynamic>>().toList();
    } catch (_) {
      return [];
    }
  }

  static Future<void> _write(List<Map<String, dynamic>> ops) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, jsonEncode(ops));
    pending.value = ops.length;
  }

  static Future<void> init() async => pending.value = (await _read()).length;

  static Future<void> _enqueue(String type, Map<String, dynamic> data) async {
    final ops = await _read();
    ops.add({'type': type, 'data': data, 'queuedAt': DateTime.now().toIso8601String()});
    await _write(ops);
  }

  /// Queue a note without trying the server first (the caller just failed).
  static Future<void> queueNote({required String title, required String content, List<String>? tags}) =>
      _enqueue('create_note', {'title': title, 'content': content, 'tags': tags ?? []});

  // --- Offline-aware actions: true = saved now, false = queued for later ---

  static Future<bool> createNote(ApiService api, {required String title, required String content, List<String>? tags}) async {
    try {
      await api.createNote(title: title, content: content, tags: tags);
      AppEvents.notifyDataChanged();
      unawaited(flush(api));
      return true;
    } catch (e) {
      if (!isNetworkError(e)) rethrow;
      await _enqueue('create_note', {'title': title, 'content': content, 'tags': tags ?? []});
      return false;
    }
  }

  static Future<bool> createTask(ApiService api, {required String title, String? dueDate, String? dueTime, String priority = 'medium'}) async {
    try {
      await api.createTask(title: title, dueDate: dueDate, dueTime: dueTime, priority: priority);
      AppEvents.notifyDataChanged();
      unawaited(flush(api));
      return true;
    } catch (e) {
      if (!isNetworkError(e)) rethrow;
      await _enqueue('create_task', {'title': title, 'dueDate': dueDate, 'dueTime': dueTime, 'priority': priority});
      return false;
    }
  }

  static Future<bool> setTaskCompleted(ApiService api, String taskId, bool completed) async {
    try {
      await api.toggleTaskCompleted(taskId, completed);
      return true;
    } catch (e) {
      if (!isNetworkError(e)) rethrow;
      await _enqueue('set_task', {'id': taskId, 'completed': completed});
      return false;
    }
  }

  /// Replays queued actions in order. Stops at the first network failure
  /// (still offline); drops an action the server rejects outright so one bad
  /// item cannot block the rest forever.
  static Future<int> flush(ApiService api) async {
    if (_flushing) return 0;
    _flushing = true;
    var sent = 0;
    try {
      final ops = await _read();
      while (ops.isNotEmpty) {
        final op = ops.first;
        final data = (op['data'] as Map?)?.cast<String, dynamic>() ?? const {};
        try {
          switch (op['type']) {
            case 'create_note':
              await api.createNote(title: data['title'] as String? ?? 'Untitled Note', content: data['content'] as String? ?? '', tags: (data['tags'] as List?)?.cast<String>());
            case 'create_task':
              await api.createTask(title: data['title'] as String? ?? '', dueDate: data['dueDate'] as String?, dueTime: data['dueTime'] as String?, priority: data['priority'] as String? ?? 'medium');
            case 'set_task':
              await api.toggleTaskCompleted(data['id'] as String, data['completed'] as bool? ?? true);
          }
          sent++;
        } catch (e) {
          if (isNetworkError(e)) break;
          debugPrint('[OfflineQueue] dropping ${op['type']}: $e');
        }
        ops.removeAt(0);
        await _write(ops);
      }
    } finally {
      _flushing = false;
    }
    if (sent > 0) AppEvents.notifyDataChanged();
    return sent;
  }
}
