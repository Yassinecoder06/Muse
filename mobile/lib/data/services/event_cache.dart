import 'dart:convert';
import 'dart:io';
import 'package:path_provider/path_provider.dart';
import '../models/event.dart';

/// Last-known copy of the user's calendar events, so schedule and events
/// remain viewable and editable when offline.
class EventCache {
  EventCache._();

  static Map<String, dynamic>? _data;
  static Future<void> _pendingWrite = Future.value();

  static Future<File> _file() async => File('${(await getApplicationSupportDirectory()).path}/muse_events_cache.json');

  static Future<Map<String, dynamic>> _load() async {
    if (_data != null) return _data!;
    try {
      final file = await _file();
      _data = await file.exists() ? jsonDecode(await file.readAsString()) as Map<String, dynamic> : null;
    } catch (_) {
      _data = null;
    }
    return _data ??= {'order': <dynamic>[], 'events': <String, dynamic>{}, 'aliases': <String, dynamic>{}};
  }

  static Future<void> _save() {
    final snapshot = jsonEncode(_data);
    return _pendingWrite = _pendingWrite.then((_) async {
      try {
        await (await _file()).writeAsString(snapshot);
      } catch (_) {
        // Best-effort local cache
      }
    });
  }

  static Map<String, dynamic> _events(Map<String, dynamic> data) => (data['events'] as Map).cast<String, dynamic>();

  static Future<void> saveEvents(List<CalendarEvent> events) async {
    final data = await _load();
    final store = _events(data);
    for (final event in events) {
      store[event.id] = event.toCacheJson();
    }
    data['order'] = events.map((e) => e.id).toList();
    await _save();
  }

  static Future<List<CalendarEvent>?> loadEvents() async {
    final data = await _load();
    final ids = (data['order'] as List?)?.cast<String>();
    if (ids == null) return null;
    final store = _events(data);
    return ids.where(store.containsKey).map((id) => CalendarEvent.fromJson((store[id] as Map).cast<String, dynamic>())).toList();
  }

  static Future<CalendarEvent?> get(String id) async {
    final raw = _events(await _load())[id];
    return raw == null ? null : CalendarEvent.fromJson((raw as Map).cast<String, dynamic>());
  }

  static Future<void> put(CalendarEvent event) async {
    final data = await _load();
    _events(data)[event.id] = event.toCacheJson();
    final order = (data['order'] as List).cast<String>();
    if (!order.contains(event.id)) {
      data['order'] = [event.id, ...order];
    }
    await _save();
  }

  static Future<void> remove(String id) async {
    final data = await _load();
    _events(data).remove(id);
    (data['order'] as List).remove(id);
    await _save();
  }

  static Future<void> replaceId(String localId, CalendarEvent created) async {
    final data = await _load();
    ((data['aliases'] ??= <String, dynamic>{}) as Map)[localId] = created.id;
    final store = _events(data)..remove(localId);
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
  static void resetForTests(Map<String, dynamic>? data) => _data = data;
}
