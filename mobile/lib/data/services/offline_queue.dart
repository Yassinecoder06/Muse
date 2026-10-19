import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../models/note.dart';
import 'api_service.dart';
import 'app_events.dart';
import 'note_cache.dart';

/// Changes made while Muse desktop is unreachable (out of Wi-Fi, laptop
/// asleep) are kept on the phone and replayed in order once it is reachable.
///
/// Note edits are merged per note. A note created offline gets a temporary
/// `local-` id and stays editable; its edits are folded into the queued create.
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
      return (jsonDecode(raw) as List<dynamic>).whereType<Map>().map((op) => op.cast<String, dynamic>()).toList();
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

  static Map<String, dynamic> _data(Map<String, dynamic> op) => (op['data'] as Map).cast<String, dynamic>();

  // --- Notes ---

  /// Queue a new note and return it with a temporary id so it can be shown
  /// and edited right away.
  static Future<Note> queueNote({required String title, required String content, List<String>? tags}) async {
    final localId = 'local-${DateTime.now().microsecondsSinceEpoch}';
    final now = DateTime.now().toIso8601String();
    await _enqueue('create_note', {'localId': localId, 'title': title, 'content': content, 'tags': tags ?? [], 'favorite': false});
    return Note(id: localId, title: title, content: content, tags: tags ?? [], favorite: false, updatedAt: now);
  }

  /// Queue an edit to a note. `base` is the note as last seen from the
  /// server; it is used to detect that the desktop changed it meanwhile.
  static Future<void> queueNoteUpdate(Note base, {String? title, String? content, List<String>? tags, bool? favorite}) async {
    final ops = await _read();
    final fields = <String, dynamic>{'title': ?title, 'content': ?content, 'tags': ?tags, 'favorite': ?favorite};

    if (base.isLocal) {
      // Not on the server yet: edit the queued create instead.
      final create = ops.where((op) => op['type'] == 'create_note' && _data(op)['localId'] == base.id).firstOrNull;
      if (create != null) {
        _data(create).addAll(fields);
        await _write(ops);
        return;
      }
      // Already synced (the editor still holds the old id): queue the edit
      // for its real note instead of dropping it.
      final serverId = await NoteCache.serverIdFor(base.id);
      if (serverId == null) return;
      base = await NoteCache.get(serverId) ?? base.copyWith(id: serverId);
    }

    final existing = ops.where((op) => op['type'] == 'update_note' && _data(op)['id'] == base.id).firstOrNull;
    if (existing != null) {
      // Keep the oldest base so the conflict check compares against what the
      // phone originally started from.
      final data = _data(existing);
      data.addAll(fields);
      if (title != null) data['baseTitle'] ??= base.title;
      if (content != null) data['baseContent'] ??= base.content;
    } else {
      ops.add({
        'type': 'update_note',
        'data': {
          'id': base.id,
          ...fields,
          if (title != null) 'baseTitle': base.title,
          if (content != null) 'baseContent': base.content,
        },
        'queuedAt': DateTime.now().toIso8601String(),
      });
    }
    await _write(ops);
  }

  /// Queued (not yet synced) edit fields for a server note, if any.
  static Future<Map<String, dynamic>?> queuedUpdateFor(String noteId) async {
    final op = (await _read()).where((op) => op['type'] == 'update_note' && _data(op)['id'] == noteId).firstOrNull;
    return op == null ? null : _data(op);
  }

  static Future<void> removeQueuedUpdate(String noteId) async {
    final ops = await _read();
    ops.removeWhere((op) => op['type'] == 'update_note' && _data(op)['id'] == noteId);
    await _write(ops);
  }

  /// Drop an offline-created note that was never synced.
  static Future<void> discardLocalNote(String localId) async {
    final ops = await _read();
    ops.removeWhere((op) => op['type'] == 'create_note' && _data(op)['localId'] == localId);
    await _write(ops);
  }

  /// Notes as the user expects to see them: server/cache state with queued
  /// edits applied, plus notes created offline (listed first in "all").
  static Future<List<Note>> overlay(List<Note> notes, String scope) async {
    final ops = await _read();
    if (ops.isEmpty) return notes;
    final updates = {
      for (final op in ops.where((op) => op['type'] == 'update_note')) _data(op)['id'] as String: _data(op),
    };
    final patched = notes.map((note) => updates.containsKey(note.id) ? _apply(note, updates[note.id]!) : note).toList();
    if (scope == 'favorites') patched.removeWhere((note) => !note.favorite);
    if (scope != 'all' && scope != 'favorites') return patched;

    final created = ops.where((op) => op['type'] == 'create_note' && _data(op)['localId'] != null).map((op) {
      final data = _data(op);
      return Note(
        id: data['localId'] as String,
        title: data['title'] as String? ?? 'Untitled Note',
        content: data['content'] as String? ?? '',
        tags: (data['tags'] as List?)?.cast<String>() ?? [],
        favorite: data['favorite'] as bool? ?? false,
        updatedAt: op['queuedAt'] as String? ?? '',
      );
    }).where((note) => scope == 'all' || note.favorite);
    return [...created.toList().reversed, ...patched];
  }

  static Note _apply(Note note, Map<String, dynamic> data) => note.copyWith(
        title: data['title'] as String?,
        content: data['content'] as String?,
        tags: (data['tags'] as List?)?.cast<String>(),
        favorite: data['favorite'] as bool?,
      );

  // --- Offline-aware actions: true = saved now, false = queued for later ---

  static Future<bool> createNote(ApiService api, {required String title, required String content, List<String>? tags}) async {
    try {
      await api.createNote(title: title, content: content, tags: tags);
      AppEvents.notifyDataChanged();
      unawaited(flush(api));
      return true;
    } catch (e) {
      if (!isNetworkError(e)) rethrow;
      await queueNote(title: title, content: content, tags: tags);
      AppEvents.notifyDataChanged();
      return false;
    }
  }

  static Future<bool> createTask(ApiService api, {required String title, String? dueDate, String? dueTime, String priority = 'medium', int? reminderMinutesBefore}) async {
    try {
      await api.createTask(title: title, dueDate: dueDate, dueTime: dueTime, priority: priority, reminderMinutesBefore: reminderMinutesBefore);
      AppEvents.notifyDataChanged();
      unawaited(flush(api));
      return true;
    } catch (e) {
      if (!isNetworkError(e)) rethrow;
      await _enqueue('create_task', {'title': title, 'dueDate': dueDate, 'dueTime': dueTime, 'priority': priority, 'reminderMinutesBefore': reminderMinutesBefore});
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
    var conflicts = 0;
    try {
      final ops = await _read();
      while (ops.isNotEmpty) {
        final op = ops.first;
        final data = _data(op);
        try {
          switch (op['type']) {
            case 'create_note':
              final created = await api.createNote(title: data['title'] as String? ?? 'Untitled Note', content: data['content'] as String? ?? '', tags: (data['tags'] as List?)?.cast<String>());
              final localId = data['localId'] as String?;
              if (localId != null) await NoteCache.replaceId(localId, created);
              // The favorite flag is its own queued step: if it fails now, the
              // create is not replayed (which would duplicate the note).
              if (data['favorite'] == true) {
                ops.insert(1, {'type': 'update_note', 'data': {'id': created.id, 'favorite': true}, 'queuedAt': DateTime.now().toIso8601String()});
              }
            case 'update_note':
              if (await _syncNoteUpdate(api, data)) conflicts++;
            case 'create_task':
              await api.createTask(
                title: data['title'] as String? ?? '',
                dueDate: data['dueDate'] as String?,
                dueTime: data['dueTime'] as String?,
                priority: data['priority'] as String? ?? 'medium',
                reminderMinutesBefore: (data['reminderMinutesBefore'] as num?)?.toInt(),
              );
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
    if (conflicts > 0) {
      AppEvents.syncMessage.value = conflicts == 1
          ? 'A note was also changed on desktop. Your phone edits were saved as a separate copy.'
          : '$conflicts notes were also changed on desktop. Your phone edits were saved as separate copies.';
    }
    return sent;
  }

  /// Applies a queued edit. If the desktop changed the same title/body since
  /// the phone went offline, nothing is overwritten: the phone version is
  /// saved as a copy instead. Returns true for a conflict.
  static Future<bool> _syncNoteUpdate(ApiService api, Map<String, dynamic> data) async {
    final id = data['id'] as String;
    final title = data['title'] as String?;
    final content = data['content'] as String?;
    final tags = (data['tags'] as List?)?.cast<String>();
    final favorite = data['favorite'] as bool?;

    if (title != null || content != null) {
      final server = await api.fetchNote(id);
      final titleConflict = title != null && data['baseTitle'] != null && server.title != data['baseTitle'] && server.title != title;
      final contentConflict = content != null && data['baseContent'] != null && server.content != data['baseContent'] && server.content != content;
      if (titleConflict || contentConflict) {
        await api.createNote(
          title: '${title ?? server.title} (edited on phone)',
          content: content ?? server.content,
          tags: tags ?? server.tags,
        );
        if (favorite != null) await api.updateNote(id, favorite: favorite);
        return true;
      }
    }

    final saved = await api.updateNote(id, title: title, content: content, tags: tags, favorite: favorite);
    await NoteCache.put(saved);
    return false;
  }
}
