import '../models/note.dart';
import 'api_service.dart';
import 'note_cache.dart';
import 'offline_queue.dart';

/// Reads and writes notes the same way online and offline. Online, results
/// are cached; offline, the cache (plus queued edits) stands in for the server.
class NoteStore {
  NoteStore._();

  /// Notes for a scope. `offline` is true when they came from the cache.
  static Future<({List<Note> notes, bool offline})> list(ApiService api, String scope) async {
    try {
      final notes = await api.fetchNotes(scope: scope);
      await NoteCache.saveList(scope, notes);
      return (notes: await OfflineQueue.overlay(notes, scope), offline: false);
    } catch (e) {
      if (!OfflineQueue.isNetworkError(e)) rethrow;
      final cached = await NoteCache.loadList(scope);
      if (cached == null) rethrow;
      return (notes: await OfflineQueue.overlay(cached, scope), offline: true);
    }
  }

  static Future<Note> get(ApiService api, String id) async {
    try {
      final note = await api.fetchNote(id);
      await NoteCache.put(note);
      final overlaid = await OfflineQueue.overlay([note], 'all');
      return overlaid.firstWhere((n) => n.id == id, orElse: () => note);
    } catch (e) {
      if (!OfflineQueue.isNetworkError(e)) rethrow;
      final cached = await NoteCache.get(id);
      if (cached == null) rethrow;
      final overlaid = await OfflineQueue.overlay([cached], 'all');
      return overlaid.firstWhere((n) => n.id == id, orElse: () => cached);
    }
  }

  /// Saves changed fields. `base` is the note as last seen from the server.
  /// Returns the server's saved note, or null if the change is queued on the
  /// phone until Muse is reachable.
  static Future<Note?> save(ApiService api, Note base, {String? title, String? content, List<String>? tags, bool? favorite}) async {
    if (base.isLocal) {
      // Synced since the editor opened it? Then save to its real id.
      final serverId = await NoteCache.serverIdFor(base.id);
      if (serverId == null) {
        await OfflineQueue.queueNoteUpdate(base, title: title, content: content, tags: tags, favorite: favorite);
        return null;
      }
      base = await NoteCache.get(serverId) ?? base.copyWith(id: serverId);
    }
    // The editor showed queued offline edits too; send them along with this
    // save (current values win) so the queue doesn't replay them later.
    final queued = await OfflineQueue.queuedUpdateFor(base.id);
    try {
      final saved = await api.updateNote(
        base.id,
        title: title ?? queued?['title'] as String?,
        content: content ?? queued?['content'] as String?,
        tags: tags ?? (queued?['tags'] as List?)?.cast<String>(),
        favorite: favorite ?? queued?['favorite'] as bool?,
      );
      if (queued != null) await OfflineQueue.removeQueuedUpdate(base.id);
      await NoteCache.put(saved);
      return saved;
    } catch (e) {
      if (!OfflineQueue.isNetworkError(e)) rethrow;
      await OfflineQueue.queueNoteUpdate(base, title: title, content: content, tags: tags, favorite: favorite);
      return null;
    }
  }
}
