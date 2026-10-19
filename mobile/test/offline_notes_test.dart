import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:muse_mobile/data/models/note.dart';
import 'package:muse_mobile/data/services/api_service.dart';
import 'package:muse_mobile/data/services/app_events.dart';
import 'package:muse_mobile/data/services/note_cache.dart';
import 'package:muse_mobile/data/services/note_store.dart';
import 'package:muse_mobile/data/services/offline_queue.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// In-memory stand-in for the Muse server.
class FakeServer extends ApiService {
  FakeServer() : super.base();
  bool online = true;
  final notes = <String, Note>{};
  var _nextId = 1;

  void _check() {
    if (!online) throw const SocketException('offline');
  }

  Note _stamp(Note note) => note.copyWith(updatedAt: DateTime.now().microsecondsSinceEpoch.toString());

  @override
  Future<List<Note>> fetchNotes({String scope = 'all'}) async {
    _check();
    return notes.values.toList();
  }

  @override
  Future<Note> fetchNote(String noteId) async {
    _check();
    return notes[noteId]!;
  }

  @override
  Future<Note> createNote({required String title, required String content, List<String>? tags}) async {
    _check();
    final note = _stamp(Note(id: 'srv-${_nextId++}', title: title, content: content, tags: tags ?? [], favorite: false, updatedAt: ''));
    return notes[note.id] = note;
  }

  @override
  Future<Note> updateNote(String noteId, {String? title, String? content, List<String>? tags, bool? favorite}) async {
    _check();
    return notes[noteId] = _stamp(notes[noteId]!.copyWith(title: title, content: content, tags: tags, favorite: favorite));
  }
}

void main() {
  late FakeServer server;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    NoteCache.resetForTests(null);
    await OfflineQueue.init();
    AppEvents.syncMessage.value = null;
    server = FakeServer();
    server.notes['a'] = Note(id: 'a', title: 'Groceries', content: '<p>milk</p>', tags: [], favorite: false, updatedAt: '1');
  });

  test('edit offline, see it in the list, sync it when back online', () async {
    final listed = await NoteStore.list(server, 'all'); // online: fills the cache
    server.online = false;

    final offlineList = await NoteStore.list(server, 'all');
    expect(offlineList.offline, isTrue);
    expect(offlineList.notes.single.title, 'Groceries');

    expect(await NoteStore.save(server, listed.notes.single, content: 'milk, eggs'), isNull); // queued
    expect(await NoteStore.save(server, listed.notes.single, title: 'Shopping'), isNull); // merged into the same edit
    expect(OfflineQueue.pending.value, 1);

    final overlaid = (await NoteStore.list(server, 'all')).notes.single;
    expect(overlaid.title, 'Shopping');
    expect(overlaid.content, 'milk, eggs');

    server.online = true;
    expect(await OfflineQueue.flush(server), 1);
    expect(server.notes['a']!.title, 'Shopping');
    expect(server.notes['a']!.content, 'milk, eggs');
    expect(server.notes.length, 1);
    expect(AppEvents.syncMessage.value, isNull);
  });

  test('desktop edited the same note meanwhile: phone version becomes a copy', () async {
    final base = (await NoteStore.list(server, 'all')).notes.single;
    server.online = false;
    await NoteStore.save(server, base, content: 'phone text');

    server.online = true;
    await server.updateNote('a', content: '<p>desktop text</p>'); // concurrent desktop edit
    await OfflineQueue.flush(server);

    expect(server.notes['a']!.content, '<p>desktop text</p>'); // not overwritten
    final copy = server.notes.values.firstWhere((n) => n.id != 'a');
    expect(copy.title, 'Groceries (edited on phone)');
    expect(copy.content, 'phone text');
    expect(AppEvents.syncMessage.value, contains('separate copy'));
  });

  test('a desktop favorite does not count as a conflict', () async {
    final base = (await NoteStore.list(server, 'all')).notes.single;
    server.online = false;
    await NoteStore.save(server, base, content: 'phone text');
    server.online = true;
    await server.updateNote('a', favorite: true);
    await OfflineQueue.flush(server);
    expect(server.notes.length, 1);
    expect(server.notes['a']!.content, 'phone text');
    expect(server.notes['a']!.favorite, isTrue);
  });

  test('note created offline is listed, editable, and keeps working after it syncs', () async {
    await NoteStore.list(server, 'all');
    server.online = false;
    final local = await OfflineQueue.queueNote(title: 'Idea', content: 'first draft');
    expect(local.isLocal, isTrue);
    expect((await NoteStore.list(server, 'all')).notes.first.id, local.id);

    expect(await NoteStore.save(server, local, content: 'second draft'), isNull);
    expect(OfflineQueue.pending.value, 1); // folded into the queued create

    server.online = true;
    await OfflineQueue.flush(server);
    final created = server.notes.values.firstWhere((n) => n.title == 'Idea');
    expect(created.content, 'second draft');

    // The editor still holds the local id; saving now goes to the real note.
    final saved = await NoteStore.save(server, local, content: 'third draft');
    expect(saved?.id, created.id);
    expect(server.notes[created.id]!.content, 'third draft');
    expect(server.notes.values.where((n) => n.title == 'Idea').length, 1);
  });

  test('saving online sends queued offline edits too, so they do not replay later', () async {
    final base = (await NoteStore.list(server, 'all')).notes.single;
    server.online = false;
    await NoteStore.save(server, base, title: 'Renamed offline');
    server.online = true;
    final saved = await NoteStore.save(server, base, content: 'online body');
    expect(saved!.title, 'Renamed offline');
    expect(saved.content, 'online body');
    expect(OfflineQueue.pending.value, 0);
  });

  test('favorite on an offline note is its own step: a failure there never duplicates the note', () async {
    server.online = false;
    final local = await OfflineQueue.queueNote(title: 'Starred idea', content: 'x');
    await NoteStore.save(server, local, favorite: true);

    server.online = true;
    await OfflineQueue.flush(server);
    final created = server.notes.values.where((n) => n.title == 'Starred idea').toList();
    expect(created.length, 1);
    expect(created.single.favorite, isTrue);
    expect(OfflineQueue.pending.value, 0);
  });

  test('editing an offline note after it synced (stale local id) still reaches the real note', () async {
    server.online = false;
    final local = await OfflineQueue.queueNote(title: 'Draft', content: 'v1');
    server.online = true;
    await OfflineQueue.flush(server);
    final realId = server.notes.values.firstWhere((n) => n.title == 'Draft').id;

    server.online = false;
    await OfflineQueue.queueNoteUpdate(local, content: 'v2'); // editor still holds local-…
    server.online = true;
    await OfflineQueue.flush(server);
    expect(server.notes[realId]!.content, 'v2');
  });
}
