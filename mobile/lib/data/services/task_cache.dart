import 'dart:convert';
import 'dart:io';
import 'package:path_provider/path_provider.dart';
import '../models/task.dart';

/// Last-known copy of the user's tasks, so they can be viewed, completed,
/// edited, and created without a connection.
class TaskCache {
  TaskCache._();

  static Map<String, dynamic>? _data;
  static Future<void> _pendingWrite = Future.value();
  static bool disableDiskForTests = false;

  static Future<File> _file() async => File('${(await getApplicationSupportDirectory()).path}/muse_tasks_cache.json');

  static Future<Map<String, dynamic>> _load() async {
    if (_data != null) return _data!;
    if (disableDiskForTests) {
      return _data = {'order': <dynamic>[], 'tasks': <String, dynamic>{}, 'aliases': <String, dynamic>{}};
    }
    try {
      final file = await _file();
      _data = await file.exists() ? jsonDecode(await file.readAsString()) as Map<String, dynamic> : null;
    } catch (_) {
      _data = null;
    }
    return _data ??= {'order': <dynamic>[], 'tasks': <String, dynamic>{}, 'aliases': <String, dynamic>{}};
  }

  static Future<void> _save() {
    if (disableDiskForTests) return Future.value();
    final snapshot = jsonEncode(_data);
    return _pendingWrite = _pendingWrite.then((_) async {
      try {
        await (await _file()).writeAsString(snapshot);
      } catch (_) {
        // Best-effort local cache
      }
    });
  }

  static Map<String, dynamic> _tasks(Map<String, dynamic> data) => (data['tasks'] as Map).cast<String, dynamic>();

  static Future<void> saveTasks(List<TodoTask> tasks) async {
    final data = await _load();
    final store = _tasks(data);
    for (final task in tasks) {
      store[task.id] = task.toCacheJson();
    }
    data['order'] = tasks.map((t) => t.id).toList();
    await _save();
  }

  static Future<List<TodoTask>?> loadTasks() async {
    final data = await _load();
    final ids = (data['order'] as List?)?.cast<String>();
    if (ids == null) return null;
    final store = _tasks(data);
    return ids.where(store.containsKey).map((id) => TodoTask.fromJson((store[id] as Map).cast<String, dynamic>())).toList();
  }

  static Future<TodoTask?> get(String id) async {
    final raw = _tasks(await _load())[id];
    return raw == null ? null : TodoTask.fromJson((raw as Map).cast<String, dynamic>());
  }

  static Future<void> put(TodoTask task) async {
    final data = await _load();
    _tasks(data)[task.id] = task.toCacheJson();
    final order = (data['order'] as List).cast<String>();
    if (!order.contains(task.id)) {
      data['order'] = [task.id, ...order];
    }
    await _save();
  }

  static Future<void> remove(String id) async {
    final data = await _load();
    _tasks(data).remove(id);
    (data['order'] as List).remove(id);
    await _save();
  }

  /// When an offline-created task gets its real server id, swap it everywhere
  /// and record alias so references stay consistent.
  static Future<void> replaceId(String localId, TodoTask created) async {
    final data = await _load();
    ((data['aliases'] ??= <String, dynamic>{}) as Map)[localId] = created.id;
    final store = _tasks(data)..remove(localId);
    store[created.id] = created.toCacheJson();
    final order = (data['order'] as List);
    final idx = order.indexOf(localId);
    if (idx != -1) {
      order[idx] = created.id;
    } else if (!order.contains(created.id)) {
      order.insert(0, created.id);
    }
    await _save();
  }

  static Future<String?> serverIdFor(String localId) async => ((await _load())['aliases'] as Map?)?[localId] as String?;

  /// Tests only
  static void resetForTests(Map<String, dynamic>? data) {
    _data = data;
    _pendingWrite = Future.value();
  }
}
