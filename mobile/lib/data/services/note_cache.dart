import 'dart:convert';
import 'dart:io';
import 'package:path_provider/path_provider.dart';
import '../models/note.dart';

/// Last-known copy of the user's notes, so they can be opened and edited
/// without a connection. Stored as one JSON file in app support storage.
class NoteCache {
  NoteCache._();

  static Map<String, dynamic>? _data;
  static Future<void> _pendingWrite = Future.value();

  static Future<File> _file() async => File('${(await getApplicationSupportDirectory()).path}/muse_notes_cache.json');

  static Future<Map<String, dynamic>> _load() async {
    if (_data != null) return _data!;
    try {
      final file = await _file();
      _data = await file.exists() ? jsonDecode(await file.readAsString()) as Map<String, dynamic> : null;
    } catch (_) {
      _data = null;
    }
    return _data ??= {'lists': <String, dynamic>{}, 'notes': <String, dynamic>{}};
  }

  // Writes are chained so a slow write never lands after a newer one.
  static Future<void> _save() {
    final snapshot = jsonEncode(_data);
    return _pendingWrite = _pendingWrite.then((_) async {
      try {
        await (await _file()).writeAsString(snapshot);
      } catch (_) {
        // Cache is best-effort; the server stays the source of truth.
      }
    });
  }

  static Map<String, dynamic> _notes(Map<String, dynamic> data) => (data['notes'] as Map).cast<String, dynamic>();

  static Future<void> saveList(String scope, List<Note> notes) async {
    final data = await _load();
    final store = _notes(data);
    for (final note in notes) {
      store[note.id] = note.toCacheJson();
    }
    (data['lists'] as Map)[scope] = notes.map((n) => n.id).toList();
    await _save();
  }

  static Future<List<Note>?> loadList(String scope) async {
    final data = await _load();
    final ids = ((data['lists'] as Map)[scope] as List?)?.cast<String>();
    if (ids == null) return null;
    final store = _notes(data);
    return ids.where(store.containsKey).map((id) => Note.fromJson((store[id] as Map).cast<String, dynamic>())).toList();
  }

  static Future<Note?> get(String id) async {
    final raw = _notes(await _load())[id];
    return raw == null ? null : Note.fromJson((raw as Map).cast<String, dynamic>());
  }

  static Future<void> put(Note note) async {
    _notes(await _load())[note.id] = note.toCacheJson();
    await _save();
  }

  static Future<void> remove(String id) async {
    final data = await _load();
    _notes(data).remove(id);
    for (final list in (data['lists'] as Map).values) {
      (list as List).remove(id);
    }
    await _save();
  }

  /// A phone-created note got its real server id: swap it everywhere, and
  /// remember the mapping so an editor still holding the old id keeps working.
  static Future<void> replaceId(String localId, Note created) async {
    final data = await _load();
    ((data['aliases'] ??= <String, dynamic>{}) as Map)[localId] = created.id;
    final store = _notes(data)..remove(localId);
    store[created.id] = created.toCacheJson();
    for (final list in (data['lists'] as Map).values) {
      final ids = list as List;
      final index = ids.indexOf(localId);
      if (index != -1) ids[index] = created.id;
    }
    await _save();
  }

  static Future<String?> serverIdFor(String localId) async => ((await _load())['aliases'] as Map?)?[localId] as String?;

  /// Tests only.
  static void resetForTests(Map<String, dynamic>? data) => _data = data;
}
