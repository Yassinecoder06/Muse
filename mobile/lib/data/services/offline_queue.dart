import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../models/event.dart';
import '../models/note.dart';
import '../models/task.dart';
import 'api_service.dart';
import 'app_events.dart';
import 'event_cache.dart';
import 'note_cache.dart';
import 'reminder_service.dart';
import 'task_cache.dart';

/// Changes made while Muse desktop is unreachable (out of Wi-Fi, laptop
/// asleep) are kept on the phone and replayed in order once it is reachable.
///
/// Edits and creations are cached locally and work 100% offline. Reminders
/// and exact alarms are scheduled directly on the phone so they ring on time.
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

  // --- Reminders helper ---
  static Future<void> _rescheduleReminders() async {
    try {
      final cachedTasks = await TaskCache.loadTasks() ?? [];
      final overlaidTasks = await overlayTasks(cachedTasks);
      final cachedEvents = await EventCache.loadEvents() ?? [];
      final overlaidEvents = await overlayEvents(cachedEvents);
      await ReminderService.sync(overlaidTasks, overlaidEvents);
    } catch (_) {}
  }

  // --- Notes ---

  /// Queue a new note and return it with a temporary id so it can be shown
  /// and edited right away.
  static Future<Note> queueNote({required String title, required String content, List<String>? tags}) async {
    final localId = 'local-${DateTime.now().microsecondsSinceEpoch}';
    final now = DateTime.now().toIso8601String();
    final note = Note(id: localId, title: title, content: content, tags: tags ?? [], favorite: false, updatedAt: now);
    await NoteCache.put(note);
    await _enqueue('create_note', {'localId': localId, 'title': title, 'content': content, 'tags': tags ?? [], 'favorite': false});
    return note;
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
        final updatedNote = base.copyWith(title: title, content: content, tags: tags, favorite: favorite);
        await NoteCache.put(updatedNote);
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
    final updatedNote = base.copyWith(title: title, content: content, tags: tags, favorite: favorite);
    await NoteCache.put(updatedNote);
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
    await NoteCache.remove(localId);
  }

  /// Queue a note deletion while offline.
  static Future<void> queueNoteDelete(String noteId) async {
    final ops = await _read();
    if (noteId.startsWith('local-')) {
      ops.removeWhere((op) => op['type'] == 'create_note' && _data(op)['localId'] == noteId);
      await _write(ops);
      await NoteCache.remove(noteId);
      return;
    }
    ops.removeWhere((op) => op['type'] == 'update_note' && _data(op)['id'] == noteId);
    ops.add({
      'type': 'delete_note',
      'data': {'id': noteId},
      'queuedAt': DateTime.now().toIso8601String(),
    });
    await _write(ops);
    await NoteCache.remove(noteId);
  }

  static Future<void> deleteNote(ApiService api, String noteId) async {
    try {
      await api.deleteNote(noteId);
      await NoteCache.remove(noteId);
      unawaited(flush(api));
    } catch (e) {
      if (!isNetworkError(e)) rethrow;
      await queueNoteDelete(noteId);
    }
  }

  /// Notes as the user expects to see them: server/cache state with queued
  /// edits applied, plus notes created offline (listed first in "all"), and deleted ones removed.
  static Future<List<Note>> overlay(List<Note> notes, String scope) async {
    final ops = await _read();
    if (ops.isEmpty) return notes;

    final deletedIds = {
      for (final op in ops.where((op) => op['type'] == 'delete_note')) _data(op)['id'] as String,
    };
    final updates = {
      for (final op in ops.where((op) => op['type'] == 'update_note')) _data(op)['id'] as String: _data(op),
    };

    final filtered = notes.where((n) => !deletedIds.contains(n.id)).toList();
    final patched = filtered.map((note) => updates.containsKey(note.id) ? _apply(note, updates[note.id]!) : note).toList();
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
    }).where((note) => !deletedIds.contains(note.id) && (scope == 'all' || note.favorite));
    return [...created.toList().reversed, ...patched];
  }

  static Note _apply(Note note, Map<String, dynamic> data) => note.copyWith(
        title: data['title'] as String?,
        content: data['content'] as String?,
        tags: (data['tags'] as List?)?.cast<String>(),
        favorite: data['favorite'] as bool?,
      );

  static Future<bool> createNote(ApiService api, {required String title, required String content, List<String>? tags}) async {
    try {
      final created = await api.createNote(title: title, content: content, tags: tags);
      await NoteCache.put(created);
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

  // --- Tasks ---

  static DateTime? _calcReminderAt(String? dueDate, String? dueTime, int? minutesBefore, DateTime? exactAt) {
    if (exactAt != null) return exactAt;
    if (minutesBefore == null || dueDate == null) return null;
    final day = DateTime.tryParse(dueDate);
    if (day == null) return null;
    final match = RegExp(r'^(\d{1,2}):(\d{2})').firstMatch(dueTime ?? '');
    final hour = match != null ? int.parse(match[1]!) : 9;
    final minute = match != null ? int.parse(match[2]!) : 0;
    final dueMoment = DateTime(day.year, day.month, day.day, hour, minute);
    return dueMoment.subtract(Duration(minutes: minutesBefore));
  }

  /// Queues a new task on phone, caches it, computes its reminder and schedules alarm right away.
  static Future<TodoTask> queueTask({
    required String title,
    String? dueDate,
    String? dueTime,
    String priority = 'medium',
    int? reminderMinutesBefore,
    DateTime? reminderAt,
    String? noteId,
  }) async {
    final localId = 'local-${DateTime.now().microsecondsSinceEpoch}';
    final computedReminderAt = _calcReminderAt(dueDate, dueTime, reminderMinutesBefore, reminderAt);

    final task = TodoTask(
      id: localId,
      title: title,
      completed: false,
      dueDate: dueDate,
      dueTime: dueTime,
      priority: priority,
      noteId: noteId,
      reminderAt: computedReminderAt,
      reminderMinutesBefore: reminderMinutesBefore,
    );

    await TaskCache.put(task);
    await _enqueue('create_task', {
      'localId': localId,
      'title': title,
      'dueDate': ?dueDate,
      'dueTime': ?dueTime,
      'priority': priority,
      'noteId': ?noteId,
      'reminderMinutesBefore': ?reminderMinutesBefore,
      if (computedReminderAt != null) 'reminderAt': computedReminderAt.toIso8601String(),
    });

    await _rescheduleReminders();
    return task;
  }

  static Future<TodoTask> createTask(
    ApiService api, {
    required String title,
    String? dueDate,
    String? dueTime,
    String priority = 'medium',
    int? reminderMinutesBefore,
    DateTime? reminderAt,
    String? noteId,
  }) async {
    try {
      final created = await api.createTask(
        title: title,
        dueDate: dueDate,
        dueTime: dueTime,
        priority: priority,
        noteId: noteId,
        reminderMinutesBefore: reminderMinutesBefore,
      );
      var finalTask = created;
      if (reminderAt != null && reminderMinutesBefore == null) {
        try {
          finalTask = await api.updateTaskReminder(created.id, at: reminderAt);
        } catch (_) {}
      }
      await TaskCache.put(finalTask);
      AppEvents.notifyDataChanged();
      unawaited(flush(api));
      return finalTask;
    } catch (e) {
      if (!isNetworkError(e)) rethrow;
      final localTask = await queueTask(
        title: title,
        dueDate: dueDate,
        dueTime: dueTime,
        priority: priority,
        reminderMinutesBefore: reminderMinutesBefore,
        reminderAt: reminderAt,
        noteId: noteId,
      );
      AppEvents.notifyDataChanged();
      return localTask;
    }
  }

  static Future<void> queueTaskUpdate(
    TodoTask base, {
    String? title,
    bool? completed,
    String? dueDate,
    String? dueTime,
    String? priority,
    int? reminderMinutesBefore,
    DateTime? reminderAt,
    bool clearReminder = false,
  }) async {
    final ops = await _read();
    final fields = <String, dynamic>{
      'title': ?title,
      'completed': ?completed,
      'dueDate': ?dueDate,
      'dueTime': ?dueTime,
      'priority': ?priority,
      if (clearReminder) 'clearReminder': true,
      if (!clearReminder && reminderMinutesBefore != null) 'reminderMinutesBefore': reminderMinutesBefore,
      if (!clearReminder && reminderAt != null) 'reminderAt': reminderAt.toIso8601String(),
    };

    final nextTitle = title ?? base.title;
    final nextCompleted = completed ?? base.completed;
    final nextDueDate = dueDate ?? base.dueDate;
    final nextDueTime = dueTime ?? base.dueTime;
    final nextPriority = priority ?? base.priority;
    DateTime? nextReminderAt = base.reminderAt;
    int? nextReminderMinutes = base.reminderMinutesBefore;

    if (clearReminder) {
      nextReminderAt = null;
      nextReminderMinutes = null;
    } else if (reminderAt != null) {
      nextReminderAt = reminderAt;
      nextReminderMinutes = null;
    } else if (reminderMinutesBefore != null || dueDate != null || dueTime != null) {
      if (reminderMinutesBefore != null) nextReminderMinutes = reminderMinutesBefore;
      if (nextReminderMinutes != null && nextDueDate != null) {
        nextReminderAt = _calcReminderAt(nextDueDate, nextDueTime, nextReminderMinutes, null);
      }
    }

    final updated = base.copyWith(
      title: nextTitle,
      completed: nextCompleted,
      dueDate: nextDueDate,
      dueTime: nextDueTime,
      priority: nextPriority,
      reminderAt: nextReminderAt,
      reminderMinutesBefore: nextReminderMinutes,
    );
    await TaskCache.put(updated);

    if (base.isLocal) {
      final create = ops.where((op) => op['type'] == 'create_task' && _data(op)['localId'] == base.id).firstOrNull;
      if (create != null) {
        _data(create).addAll(fields);
        await _write(ops);
        await _rescheduleReminders();
        return;
      }
      final serverId = await TaskCache.serverIdFor(base.id);
      if (serverId != null) {
        base = await TaskCache.get(serverId) ?? base.copyWith(id: serverId);
      }
    }

    final existing = ops.where((op) => (op['type'] == 'update_task' || op['type'] == 'set_task') && _data(op)['id'] == base.id).firstOrNull;
    if (existing != null) {
      existing['type'] = 'update_task';
      _data(existing).addAll(fields);
    } else {
      ops.add({
        'type': 'update_task',
        'data': {'id': base.id, ...fields},
        'queuedAt': DateTime.now().toIso8601String(),
      });
    }
    await _write(ops);
    await _rescheduleReminders();
  }

  static Future<bool> setTaskCompleted(ApiService api, String taskId, bool completed) async {
    final cached = await TaskCache.get(taskId);
    if (cached != null) {
      await TaskCache.put(cached.copyWith(completed: completed));
    }
    await _rescheduleReminders();

    try {
      await api.toggleTaskCompleted(taskId, completed);
      unawaited(flush(api));
      return true;
    } catch (e) {
      if (!isNetworkError(e)) rethrow;
      final ops = await _read();
      final existing = ops.where((op) => op['type'] == 'update_task' && _data(op)['id'] == taskId).firstOrNull;
      if (existing != null) {
        _data(existing)['completed'] = completed;
      } else {
        ops.add({
          'type': 'set_task',
          'data': {'id': taskId, 'completed': completed},
          'queuedAt': DateTime.now().toIso8601String(),
        });
      }
      await _write(ops);
      return false;
    }
  }

  static Future<void> queueTaskDelete(String taskId) async {
    final ops = await _read();
    if (taskId.startsWith('local-')) {
      ops.removeWhere((op) => op['type'] == 'create_task' && _data(op)['localId'] == taskId);
      await _write(ops);
      await TaskCache.remove(taskId);
      await ReminderService.stopAlarm(taskId);
      await _rescheduleReminders();
      return;
    }

    ops.removeWhere((op) => (op['type'] == 'update_task' || op['type'] == 'set_task') && _data(op)['id'] == taskId);
    ops.add({
      'type': 'delete_task',
      'data': {'id': taskId},
      'queuedAt': DateTime.now().toIso8601String(),
    });
    await _write(ops);
    await TaskCache.remove(taskId);
    await ReminderService.stopAlarm(taskId);
    await _rescheduleReminders();
  }

  static Future<void> deleteTask(ApiService api, String taskId) async {
    await TaskCache.remove(taskId);
    await ReminderService.stopAlarm(taskId);
    try {
      await api.deleteTask(taskId);
      unawaited(flush(api));
    } catch (e) {
      if (!isNetworkError(e)) rethrow;
      await queueTaskDelete(taskId);
    }
  }

  static Future<List<TodoTask>> overlayTasks(List<TodoTask> tasks) async {
    final ops = await _read();
    if (ops.isEmpty) return tasks;

    final deletedIds = {
      for (final op in ops.where((op) => op['type'] == 'delete_task')) _data(op)['id'] as String,
    };
    final updates = {
      for (final op in ops.where((op) => op['type'] == 'update_task' || op['type'] == 'set_task')) _data(op)['id'] as String: _data(op),
    };

    final filtered = tasks.where((t) => !deletedIds.contains(t.id)).toList();
    final patched = filtered.map((task) {
      if (!updates.containsKey(task.id)) return task;
      final d = updates[task.id]!;
      DateTime? remAt = task.reminderAt;
      int? remMin = task.reminderMinutesBefore;
      if (d['clearReminder'] == true) {
        remAt = null;
        remMin = null;
      } else if (d['reminderAt'] != null) {
        remAt = DateTime.tryParse(d['reminderAt'] as String);
        remMin = null;
      } else if (d['reminderMinutesBefore'] != null) {
        remMin = (d['reminderMinutesBefore'] as num).toInt();
        remAt = _calcReminderAt(d['dueDate'] as String? ?? task.dueDate, d['dueTime'] as String? ?? task.dueTime, remMin, null);
      }
      return task.copyWith(
        title: d['title'] as String?,
        completed: d['completed'] as bool?,
        dueDate: d['dueDate'] as String?,
        dueTime: d['dueTime'] as String?,
        priority: d['priority'] as String?,
        reminderAt: remAt,
        reminderMinutesBefore: remMin,
      );
    }).toList();

    final created = ops.where((op) => op['type'] == 'create_task' && _data(op)['localId'] != null).map((op) {
      final d = _data(op);
      final localId = d['localId'] as String;
      DateTime? remAt = d['reminderAt'] != null ? DateTime.tryParse(d['reminderAt'] as String) : null;
      final remMin = (d['reminderMinutesBefore'] as num?)?.toInt();
      if (remAt == null && remMin != null && d['dueDate'] != null) {
        remAt = _calcReminderAt(d['dueDate'] as String?, d['dueTime'] as String?, remMin, null);
      }
      return TodoTask(
        id: localId,
        title: d['title'] as String? ?? '',
        completed: d['completed'] as bool? ?? false,
        dueDate: d['dueDate'] as String?,
        dueTime: d['dueTime'] as String?,
        priority: d['priority'] as String? ?? 'medium',
        noteId: d['noteId'] as String?,
        reminderAt: remAt,
        reminderMinutesBefore: remMin,
      );
    }).where((task) => !deletedIds.contains(task.id));

    return [...created.toList().reversed, ...patched];
  }

  // --- Calendar Events ---

  static Future<CalendarEvent> queueEvent({
    required String title,
    required DateTime startTime,
    DateTime? endTime,
    bool allDay = false,
    String location = '',
    String description = '',
    String? noteId,
  }) async {
    final localId = 'local-${DateTime.now().microsecondsSinceEpoch}';
    final event = CalendarEvent(
      id: localId,
      title: title,
      description: description,
      startTime: startTime,
      endTime: endTime,
      allDay: allDay,
      location: location,
      noteId: noteId,
    );

    await EventCache.put(event);
    await _enqueue('create_event', {
      'localId': localId,
      'title': title,
      'description': description,
      'startTime': startTime.toIso8601String(),
      if (endTime != null) 'endTime': endTime.toIso8601String(),
      'allDay': allDay,
      'location': location,
      'noteId': ?noteId,
    });

    await _rescheduleReminders();
    return event;
  }

  static Future<CalendarEvent> createEvent(
    ApiService api, {
    required String title,
    required DateTime startTime,
    DateTime? endTime,
    bool allDay = false,
    String location = '',
    String description = '',
    String? noteId,
  }) async {
    try {
      final created = await api.createEvent(
        title: title,
        startTime: startTime,
        endTime: endTime,
        allDay: allDay,
        location: location,
        description: description,
        noteId: noteId,
      );
      await EventCache.put(created);
      AppEvents.notifyDataChanged();
      unawaited(flush(api));
      return created;
    } catch (e) {
      if (!isNetworkError(e)) rethrow;
      final local = await queueEvent(
        title: title,
        startTime: startTime,
        endTime: endTime,
        allDay: allDay,
        location: location,
        description: description,
        noteId: noteId,
      );
      AppEvents.notifyDataChanged();
      return local;
    }
  }

  static Future<void> queueEventUpdate(
    CalendarEvent base, {
    String? title,
    DateTime? startTime,
    DateTime? endTime,
    bool? allDay,
    String? location,
    String? description,
    String? noteId,
  }) async {
    final ops = await _read();
    final fields = <String, dynamic>{
      'title': ?title,
      if (startTime != null) 'startTime': startTime.toIso8601String(),
      if (endTime != null) 'endTime': endTime.toIso8601String(),
      'allDay': ?allDay,
      'location': ?location,
      'description': ?description,
      'noteId': ?noteId,
    };

    final updated = base.copyWith(
      title: title,
      startTime: startTime,
      endTime: endTime,
      allDay: allDay,
      location: location,
      description: description,
      noteId: noteId,
    );
    await EventCache.put(updated);

    if (base.isLocal) {
      final create = ops.where((op) => op['type'] == 'create_event' && _data(op)['localId'] == base.id).firstOrNull;
      if (create != null) {
        _data(create).addAll(fields);
        await _write(ops);
        await _rescheduleReminders();
        return;
      }
      final serverId = await EventCache.serverIdFor(base.id);
      if (serverId != null) {
        base = await EventCache.get(serverId) ?? base.copyWith(id: serverId);
      }
    }

    final existing = ops.where((op) => op['type'] == 'update_event' && _data(op)['id'] == base.id).firstOrNull;
    if (existing != null) {
      _data(existing).addAll(fields);
    } else {
      ops.add({
        'type': 'update_event',
        'data': {'id': base.id, ...fields},
        'queuedAt': DateTime.now().toIso8601String(),
      });
    }
    await _write(ops);
    await _rescheduleReminders();
  }

  static Future<void> queueEventDelete(String eventId) async {
    final ops = await _read();
    if (eventId.startsWith('local-')) {
      ops.removeWhere((op) => op['type'] == 'create_event' && _data(op)['localId'] == eventId);
      await _write(ops);
      await EventCache.remove(eventId);
      await _rescheduleReminders();
      return;
    }

    ops.removeWhere((op) => op['type'] == 'update_event' && _data(op)['id'] == eventId);
    ops.add({
      'type': 'delete_event',
      'data': {'id': eventId},
      'queuedAt': DateTime.now().toIso8601String(),
    });
    await _write(ops);
    await EventCache.remove(eventId);
    await _rescheduleReminders();
  }

  static Future<void> deleteEvent(ApiService api, String eventId) async {
    await EventCache.remove(eventId);
    try {
      await api.deleteEvent(eventId);
      unawaited(flush(api));
    } catch (e) {
      if (!isNetworkError(e)) rethrow;
      await queueEventDelete(eventId);
    }
  }

  static Future<List<CalendarEvent>> overlayEvents(List<CalendarEvent> events) async {
    final ops = await _read();
    if (ops.isEmpty) return events;

    final deletedIds = {
      for (final op in ops.where((op) => op['type'] == 'delete_event')) _data(op)['id'] as String,
    };
    final updates = {
      for (final op in ops.where((op) => op['type'] == 'update_event')) _data(op)['id'] as String: _data(op),
    };

    final filtered = events.where((e) => !deletedIds.contains(e.id)).toList();
    final patched = filtered.map((ev) {
      if (!updates.containsKey(ev.id)) return ev;
      final d = updates[ev.id]!;
      return ev.copyWith(
        title: d['title'] as String?,
        description: d['description'] as String?,
        startTime: d['startTime'] != null ? DateTime.tryParse(d['startTime'] as String) : null,
        endTime: d['endTime'] != null ? DateTime.tryParse(d['endTime'] as String) : null,
        allDay: d['allDay'] as bool?,
        location: d['location'] as String?,
        noteId: d['noteId'] as String?,
      );
    }).toList();

    final created = ops.where((op) => op['type'] == 'create_event' && _data(op)['localId'] != null).map((op) {
      final d = _data(op);
      return CalendarEvent(
        id: d['localId'] as String,
        title: d['title'] as String? ?? 'Untitled Event',
        description: d['description'] as String? ?? '',
        startTime: DateTime.tryParse(d['startTime'] as String? ?? '') ?? DateTime.now(),
        endTime: d['endTime'] != null ? DateTime.tryParse(d['endTime'] as String) : null,
        allDay: d['allDay'] as bool? ?? false,
        location: d['location'] as String? ?? '',
        noteId: d['noteId'] as String?,
      );
    }).where((e) => !deletedIds.contains(e.id));

    return [...created.toList().reversed, ...patched];
  }

  // --- Flush (Sync when reconnected) ---

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
              final created = await api.createNote(
                title: data['title'] as String? ?? 'Untitled Note',
                content: data['content'] as String? ?? '',
                tags: (data['tags'] as List?)?.cast<String>(),
              );
              final localId = data['localId'] as String?;
              if (localId != null) await NoteCache.replaceId(localId, created);
              if (data['favorite'] == true) {
                ops.insert(1, {'type': 'update_note', 'data': {'id': created.id, 'favorite': true}, 'queuedAt': DateTime.now().toIso8601String()});
              }

            case 'update_note':
              if (await _syncNoteUpdate(api, data)) conflicts++;

            case 'delete_note':
              await api.deleteNote(data['id'] as String);

            case 'create_task':
              final created = await api.createTask(
                title: data['title'] as String? ?? '',
                dueDate: data['dueDate'] as String?,
                dueTime: data['dueTime'] as String?,
                priority: data['priority'] as String? ?? 'medium',
                reminderMinutesBefore: (data['reminderMinutesBefore'] as num?)?.toInt(),
                noteId: data['noteId'] as String?,
              );
              var finalTask = created;
              if (data['reminderAt'] != null && data['reminderMinutesBefore'] == null) {
                try {
                  finalTask = await api.updateTaskReminder(created.id, at: DateTime.parse(data['reminderAt'] as String));
                } catch (_) {}
              }
              final localId = data['localId'] as String?;
              if (localId != null) {
                await TaskCache.replaceId(localId, finalTask);
              } else {
                await TaskCache.put(finalTask);
              }

            case 'update_task':
              final id = data['id'] as String;
              final realId = id.startsWith('local-') ? (await TaskCache.serverIdFor(id) ?? id) : id;
              if (realId.startsWith('local-')) break;
              final updated = await api.updateTask(
                realId,
                title: data['title'] as String?,
                completed: data['completed'] as bool?,
                dueDate: data['dueDate'] as String?,
                dueTime: data['dueTime'] as String?,
                priority: data['priority'] as String?,
                reminderMinutesBefore: (data['reminderMinutesBefore'] as num?)?.toInt(),
                reminderAt: data['reminderAt'] != null ? DateTime.tryParse(data['reminderAt'].toString()) : null,
                clearReminder: data['clearReminder'] == true,
              );
              await TaskCache.put(updated);

            case 'set_task':
              final id = data['id'] as String;
              final realId = id.startsWith('local-') ? (await TaskCache.serverIdFor(id) ?? id) : id;
              if (realId.startsWith('local-')) break;
              if (data.containsKey('title') || data.containsKey('reminderMinutesBefore') || data.containsKey('dueDate') || data.containsKey('dueTime')) {
                final updated = await api.updateTask(
                  realId,
                  title: data['title'] as String?,
                  completed: data['completed'] as bool?,
                  dueDate: data['dueDate'] as String?,
                  dueTime: data['dueTime'] as String?,
                  priority: data['priority'] as String?,
                  reminderMinutesBefore: (data['reminderMinutesBefore'] as num?)?.toInt(),
                  reminderAt: data['reminderAt'] != null ? DateTime.tryParse(data['reminderAt'].toString()) : null,
                  clearReminder: data['clearReminder'] == true,
                );
                await TaskCache.put(updated);
              } else {
                await api.toggleTaskCompleted(realId, data['completed'] as bool? ?? true);
              }

            case 'delete_task':
              final id = data['id'] as String;
              final realId = id.startsWith('local-') ? (await TaskCache.serverIdFor(id) ?? id) : id;
              if (!realId.startsWith('local-')) {
                await api.deleteTask(realId);
              }

            case 'create_event':
              final created = await api.createEvent(
                title: data['title'] as String? ?? 'Untitled Event',
                description: data['description'] as String? ?? '',
                startTime: DateTime.parse(data['startTime'] as String),
                endTime: data['endTime'] != null ? DateTime.parse(data['endTime'] as String) : null,
                allDay: data['allDay'] as bool? ?? false,
                location: data['location'] as String? ?? '',
                noteId: data['noteId'] as String?,
              );
              final localId = data['localId'] as String?;
              if (localId != null) {
                await EventCache.replaceId(localId, created);
              } else {
                await EventCache.put(created);
              }

            case 'update_event':
              final id = data['id'] as String;
              final realId = id.startsWith('local-') ? (await EventCache.serverIdFor(id) ?? id) : id;
              if (realId.startsWith('local-')) break;
              final updated = await api.updateEvent(
                realId,
                title: data['title'] as String?,
                description: data['description'] as String?,
                startTime: data['startTime'] != null ? DateTime.parse(data['startTime'] as String) : null,
                endTime: data['endTime'] != null ? DateTime.parse(data['endTime'] as String) : null,
                allDay: data['allDay'] as bool?,
                location: data['location'] as String?,
                noteId: data['noteId'] as String?,
              );
              await EventCache.put(updated);

            case 'delete_event':
              final id = data['id'] as String;
              final realId = id.startsWith('local-') ? (await EventCache.serverIdFor(id) ?? id) : id;
              if (!realId.startsWith('local-')) {
                await api.deleteEvent(realId);
              }
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
    if (sent > 0) {
      AppEvents.notifyDataChanged();
      await _rescheduleReminders();
    }
    if (conflicts > 0) {
      AppEvents.syncMessage.value = conflicts == 1
          ? 'A note was also changed on desktop. Your phone edits were saved as a separate copy.'
          : '$conflicts notes were also changed on desktop. Your phone edits were saved as separate copies.';
    }
    return sent;
  }

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
