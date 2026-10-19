import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../data/models/note.dart';
import '../../data/services/api_service.dart';
import '../../data/services/app_events.dart';
import '../../data/services/note_store.dart';
import '../../data/services/offline_queue.dart';
import '../theme/app_theme.dart';
import 'note_detail_view.dart';

class NotesTab extends StatefulWidget {
  const NotesTab({super.key});

  @override
  State<NotesTab> createState() => _NotesTabState();
}

class _NotesTabState extends State<NotesTab> {
  final ApiService _api = ApiService();

  List<Note> _allNotes = [];
  bool _loading = true;
  String _search = '';
  String? _error;
  // Showing the on-device copy because Muse is unreachable.
  bool _offline = false;

  // Server search (keywords + meaning) for the "all" scope; null = not run.
  final _searchController = TextEditingController();
  Timer? _searchDebounce;
  List<Note>? _searchResults;
  String _searchResultsFor = '';
  bool _searching = false;

  // Scopes: 'all', 'favorites', 'archive', 'trash'
  String _currentScope = 'all';

  @override
  void initState() {
    super.initState();
    _loadNotes();
    AppEvents.dataChanged.addListener(_onDataChanged);
  }

  @override
  void dispose() {
    AppEvents.dataChanged.removeListener(_onDataChanged);
    _searchDebounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  void _onSearchChanged(String value) {
    final query = value.trim();
    setState(() => _search = query);
    _searchDebounce?.cancel();
    if (query.length < 2 || _currentScope != 'all') {
      setState(() => _searchResults = null);
      return;
    }
    _searchDebounce = Timer(const Duration(milliseconds: 400), () => _runServerSearch(query));
  }

  Future<void> _runServerSearch(String query) async {
    setState(() => _searching = true);
    try {
      final results = await _api.searchNotes(query);
      if (!mounted || query != _search) return;
      setState(() {
        _searchResults = results;
        _searchResultsFor = query;
      });
    } catch (_) {
      // Offline: the local title/content filter still works.
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  void _clearSearch() {
    _searchDebounce?.cancel();
    _searchController.clear();
    setState(() {
      _search = '';
      _searchResults = null;
    });
  }

  // Trash right away, offer Undo (restore) for a few seconds.
  Future<void> _trashWithUndo(Note note) async {
    final index = _allNotes.indexWhere((n) => n.id == note.id);
    setState(() => _allNotes.removeWhere((n) => n.id == note.id));
    final messenger = ScaffoldMessenger.of(context);
    try {
      await _api.deleteNote(note.id);
    } catch (e) {
      if (!mounted) return;
      setState(() => _allNotes.insert(index.clamp(0, _allNotes.length), note));
      messenger.showSnackBar(SnackBar(content: Text('Could not move to trash: ${e.toString().replaceFirst('Exception: ', '')}'), backgroundColor: Colors.redAccent));
      return;
    }
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(SnackBar(
      content: const Text('Moved to trash'),
      duration: const Duration(seconds: 4),
      action: SnackBarAction(
        label: 'Undo',
        onPressed: () async {
          try {
            await _api.restoreNote(note.id);
            if (mounted) setState(() => _allNotes.insert(index.clamp(0, _allNotes.length), note));
          } catch (_) {}
        },
      ),
    ));
  }

  // Bip created or deleted something: refresh quietly, keeping the list on screen.
  void _onDataChanged() => _loadNotes(silent: true);

  Future<void> _loadNotes({bool silent = false}) async {
    if (!silent) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      // Falls back to the on-device copy (with unsynced edits) when offline.
      final result = await NoteStore.list(_api, _currentScope);
      if (!mounted) return;
      setState(() {
        _allNotes = result.notes;
        _offline = result.offline;
        _loading = false;
      });
    } catch (e) {
      if (!mounted || silent) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  Future<void> _setScope(String scope) async {
    if (_currentScope == scope) return;
    setState(() {
      _currentScope = scope;
    });
    await _loadNotes();
  }

  Future<void> _toggleFavorite(Note note) async {
    final nextFav = !note.favorite;
    setState(() {
      final index = _allNotes.indexWhere((n) => n.id == note.id);
      if (index != -1) {
        _allNotes[index] = note.copyWith(favorite: nextFav);
      }
    });

    try {
      await NoteStore.save(_api, note, favorite: nextFav); // queued when offline
    } catch (_) {
      // Revert if the server rejected it
      setState(() {
        final index = _allNotes.indexWhere((n) => n.id == note.id);
        if (index != -1) {
          _allNotes[index] = note.copyWith(favorite: !nextFav);
        }
      });
    }
  }

  Future<void> _restoreNote(Note note) async {
    try {
      await _api.restoreNote(note.id);
      setState(() {
        _allNotes.removeWhere((n) => n.id == note.id);
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Note restored to your workspace')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to restore: $e'), backgroundColor: Colors.redAccent),
        );
      }
    }
  }

  Future<void> _deletePermanently(Note note) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.surface,
        title: const Text('Delete permanently?', style: TextStyle(color: AppTheme.textPrimary)),
        content: const Text(
          'This note will be permanently erased and cannot be recovered.',
          style: TextStyle(color: AppTheme.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel', style: TextStyle(color: AppTheme.textSecondary)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.redAccent),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );

    if (confirm == true) {
      try {
        await _api.deleteNotePermanently(note.id);
        setState(() {
          _allNotes.removeWhere((n) => n.id == note.id);
        });
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Note permanently deleted')),
          );
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Failed to delete: $e'), backgroundColor: Colors.redAccent),
          );
        }
      }
    }
  }

  Future<void> _emptyTrash() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.surface,
        title: const Text('Empty Trash?', style: TextStyle(color: AppTheme.textPrimary)),
        content: const Text(
          'Every note in the trash will be permanently destroyed.',
          style: TextStyle(color: AppTheme.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel', style: TextStyle(color: AppTheme.textSecondary)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.redAccent),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Empty Trash', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );

    if (confirm == true) {
      try {
        await _api.emptyTrash();
        setState(() => _allNotes.clear());
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Trash emptied')),
          );
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Failed to empty trash: $e'), backgroundColor: Colors.redAccent),
          );
        }
      }
    }
  }

  void _showCreateNoteSheet() {
    final titleController = TextEditingController();
    final contentController = TextEditingController();

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
          left: 20,
          right: 20,
          top: 20,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'New Note',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
                ),
                IconButton(
                  icon: const Icon(Icons.close, color: AppTheme.textSecondary),
                  onPressed: () => Navigator.pop(ctx),
                ),
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: titleController,
              autofocus: true,
              style: const TextStyle(color: AppTheme.textPrimary, fontWeight: FontWeight.w600),
              decoration: InputDecoration(
                hintText: 'Note Title',
                hintStyle: const TextStyle(color: AppTheme.textSecondary),
                filled: true,
                fillColor: AppTheme.background,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: contentController,
              maxLines: 6,
              style: const TextStyle(color: AppTheme.textPrimary),
              decoration: InputDecoration(
                hintText: 'Type your thoughts or paste ideas…',
                hintStyle: const TextStyle(color: AppTheme.textSecondary),
                filled: true,
                fillColor: AppTheme.background,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
              ),
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.primary,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              onPressed: () async {
                final title = titleController.text.trim();
                final content = contentController.text.trim();
                if (title.isEmpty && content.isEmpty) return;

                Navigator.pop(ctx);
                try {
                  final Note created;
                  try {
                    created = await _api.createNote(
                      title: title.isEmpty ? 'Untitled Note' : title,
                      content: content,
                      tags: ['mobile'],
                    );
                  } catch (e) {
                    // Desktop unreachable: keep the note on the phone and sync later.
                    if (!OfflineQueue.isNetworkError(e)) rethrow;
                    final local = await OfflineQueue.queueNote(title: title.isEmpty ? 'Untitled Note' : title, content: content, tags: ['mobile']);
                    await _loadNotes(silent: true);
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Saved on your phone. It will sync when Muse is reachable.')),
                      );
                      Navigator.push(context, MaterialPageRoute(builder: (context) => NoteDetailView(note: local))).then((_) => _loadNotes(silent: true));
                    }
                    return;
                  }
                  await _loadNotes();
                  if (mounted) {
                    Navigator.push(
                      context,
                      MaterialPageRoute(builder: (context) => NoteDetailView(note: created)),
                    ).then((_) => _loadNotes());
                  }
                } catch (e) {
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('Failed to save note: $e'), backgroundColor: Colors.redAccent),
                    );
                  }
                }
              },
              child: const Text('Create Note', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final todayStr = DateFormat('EEEE, MMMM d').format(now);

    final useServerResults = _searchResults != null && _searchResultsFor == _search && _currentScope == 'all';
    final filtered = useServerResults
        ? _searchResults!
        : _allNotes.where((n) {
            if (_search.isEmpty) return true;
            final q = _search.toLowerCase();
            return n.title.toLowerCase().contains(q) ||
                n.plainText.toLowerCase().contains(q) ||
                n.tags.any((t) => t.toLowerCase().contains(q));
          }).toList();

    // Divide into Starred and Others when in "all" scope
    final starredNotes = _currentScope == 'all' && _search.isEmpty
        ? filtered.where((n) => n.favorite).toList()
        : <Note>[];
    final otherNotes = _currentScope == 'all' && _search.isEmpty
        ? filtered.where((n) => !n.favorite).toList()
        : filtered;

    return Scaffold(
      backgroundColor: AppTheme.background,
      floatingActionButton: FloatingActionButton(
        onPressed: _showCreateNoteSheet,
        tooltip: 'New Note',
        child: const Icon(Icons.edit_rounded),
      ),
      body: RefreshIndicator(
        onRefresh: _loadNotes,
        color: AppTheme.primaryLight,
        child: CustomScrollView(
          slivers: [
            // Hero Header matching desktop Muse
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      todayStr,
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: AppTheme.textSecondary.withValues(alpha: 0.8),
                        letterSpacing: 0.5,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Expanded(
                          child: Text(
                            now.hour < 12 ? 'Good morning.' : now.hour < 18 ? 'Good afternoon.' : 'Good evening.',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 22,
                              fontWeight: FontWeight.bold,
                              color: AppTheme.textPrimary,
                            ),
                          ),
                        ),
                        IconButton(
                          icon: const Icon(Icons.add_circle_outline_rounded, color: AppTheme.primaryLight, size: 26),
                          tooltip: 'Quick Note',
                          onPressed: _showCreateNoteSheet,
                        ),
                      ],
                    ),
                    const SizedBox(height: 2),
                    const Text(
                      'A quiet space for your thoughts & workspace.',
                      style: TextStyle(
                        fontSize: 13,
                        color: AppTheme.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
            ),

            // Scope Filter Navigation Strip (All, Favorites, Archive, Trash)
            SliverToBoxAdapter(
              child: SizedBox(
                height: 44,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  children: [
                    _buildScopeChip(
                      id: 'all',
                      label: 'All notes',
                      icon: Icons.notes_rounded,
                      count: _currentScope == 'all' ? _allNotes.length : null,
                    ),
                    _buildScopeChip(
                      id: 'favorites',
                      label: 'Favorites',
                      icon: Icons.star_rounded,
                      iconColor: Colors.amber,
                      count: _currentScope == 'favorites' ? _allNotes.length : null,
                    ),
                    _buildScopeChip(
                      id: 'archive',
                      label: 'Archive',
                      icon: Icons.archive_outlined,
                      count: _currentScope == 'archive' ? _allNotes.length : null,
                    ),
                    _buildScopeChip(
                      id: 'trash',
                      label: 'Trash',
                      icon: Icons.delete_outline_rounded,
                      iconColor: Colors.redAccent,
                      count: _currentScope == 'trash' ? _allNotes.length : null,
                    ),
                  ],
                ),
              ),
            ),

            if (_offline)
              const SliverToBoxAdapter(
                child: Padding(
                  padding: EdgeInsets.fromLTRB(18, 8, 18, 0),
                  child: Row(
                    children: [
                      Icon(Icons.cloud_off_rounded, size: 16, color: Colors.amber),
                      SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'Offline: showing the copy saved on this phone. Edits sync when Muse is reachable.',
                          style: TextStyle(fontSize: 12, color: Colors.amber),
                        ),
                      ),
                    ],
                  ),
                ),
              ),

            // Search Bar
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(18, 12, 18, 10),
                child: TextField(
                  controller: _searchController,
                  style: const TextStyle(color: AppTheme.textPrimary, fontSize: 14),
                  onChanged: _onSearchChanged,
                  decoration: InputDecoration(
                    hintText: _currentScope == 'all' ? 'Search by words or meaning…' : 'Search title, content, or #tag…',
                    helperText: useServerResults ? 'Matches by keyword and by meaning' : null,
                    helperStyle: const TextStyle(color: AppTheme.textSecondary, fontSize: 11),
                    hintStyle: const TextStyle(color: AppTheme.textSecondary, fontSize: 13),
                    prefixIcon: _searching
                        ? const Padding(
                            padding: EdgeInsets.all(13),
                            child: SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.primaryLight)),
                          )
                        : const Icon(Icons.search, color: AppTheme.textSecondary, size: 20),
                    suffixIcon: _search.isNotEmpty
                        ? IconButton(
                            icon: const Icon(Icons.clear, color: AppTheme.textSecondary, size: 18),
                            onPressed: _clearSearch,
                          )
                        : null,
                    filled: true,
                    fillColor: AppTheme.surface,
                    contentPadding: const EdgeInsets.symmetric(vertical: 10, horizontal: 16),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(14),
                      borderSide: const BorderSide(color: AppTheme.surfaceBorder),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(14),
                      borderSide: const BorderSide(color: AppTheme.surfaceBorder),
                    ),
                  ),
                ),
              ),
            ),

            // Trash Toolbar banner if in trash
            if (_currentScope == 'trash')
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(18, 0, 18, 10),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                    decoration: BoxDecoration(
                      color: Colors.redAccent.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: Colors.redAccent.withValues(alpha: 0.3)),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.info_outline_rounded, size: 18, color: Colors.redAccent),
                        const SizedBox(width: 8),
                        const Expanded(
                          child: Text(
                            'Trash notes can be restored or permanently erased.',
                            style: TextStyle(fontSize: 12, color: Colors.redAccent),
                          ),
                        ),
                        if (_allNotes.isNotEmpty)
                          TextButton(
                            style: TextButton.styleFrom(
                              foregroundColor: Colors.redAccent,
                              padding: const EdgeInsets.symmetric(horizontal: 8),
                            ),
                            onPressed: _emptyTrash,
                            child: const Text('Empty Trash', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                          ),
                      ],
                    ),
                  ),
                ),
              ),

            // Main Content Area
            if (_loading)
              const SliverFillRemaining(
                child: Center(child: CircularProgressIndicator(color: AppTheme.primaryLight)),
              )
            else if (_error != null)
              SliverFillRemaining(
                child: Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24.0),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.cloud_off_rounded, color: Colors.orangeAccent, size: 48),
                        const SizedBox(height: 12),
                        Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: AppTheme.textSecondary)),
                        const SizedBox(height: 16),
                        ElevatedButton.icon(
                          onPressed: _loadNotes,
                          icon: const Icon(Icons.refresh),
                          label: const Text('Retry'),
                        ),
                      ],
                    ),
                  ),
                ),
              )
            else if (filtered.isEmpty)
              SliverFillRemaining(
                child: _buildEmptyState(),
              )
            else ...[
              // Section 1: Starred / Pinned Notes (if available)
              if (starredNotes.isNotEmpty) ...[
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(20, 6, 20, 8),
                    child: Row(
                      children: [
                        const Icon(Icons.star_rounded, size: 16, color: Colors.amber),
                        const SizedBox(width: 6),
                        Text(
                          'STARRED NOTES (${starredNotes.length})',
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.bold,
                            color: Colors.amber,
                            letterSpacing: 0.8,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                SliverPadding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  sliver: SliverList(
                    delegate: SliverChildBuilderDelegate(
                      (context, index) => _buildNoteCard(starredNotes[index]),
                      childCount: starredNotes.length,
                    ),
                  ),
                ),
                const SliverToBoxAdapter(child: SizedBox(height: 12)),
              ],

              // Section 2: Recent / Other Notes
              if (otherNotes.isNotEmpty) ...[
                if (starredNotes.isNotEmpty)
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(20, 6, 20, 8),
                      child: Text(
                        'RECENT NOTES (${otherNotes.length})',
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.bold,
                          color: AppTheme.textSecondary,
                          letterSpacing: 0.8,
                        ),
                      ),
                    ),
                  ),
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 80),
                  sliver: SliverList(
                    delegate: SliverChildBuilderDelegate(
                      (context, index) => _buildNoteCard(otherNotes[index]),
                      childCount: otherNotes.length,
                    ),
                  ),
                ),
              ],
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildScopeChip({
    required String id,
    required String label,
    required IconData icon,
    Color? iconColor,
    int? count,
  }) {
    final isSelected = _currentScope == id;
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: FilterChip(
        selected: isSelected,
        avatar: Icon(
          icon,
          size: 15,
          color: isSelected ? Colors.white : (iconColor ?? AppTheme.textSecondary),
        ),
        label: Text(
          count != null ? '$label ($count)' : label,
          style: TextStyle(
            fontSize: 12,
            fontWeight: isSelected ? FontWeight.bold : FontWeight.w500,
            color: isSelected ? Colors.white : AppTheme.textPrimary,
          ),
        ),
        backgroundColor: AppTheme.surface,
        selectedColor: AppTheme.primary,
        side: BorderSide(
          color: isSelected ? AppTheme.primaryLight : AppTheme.surfaceBorder,
          width: 1,
        ),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        onSelected: (_) => _setScope(id),
      ),
    );
  }

  Widget _buildNoteCard(Note note) {
    final isTrash = _currentScope == 'trash';
    final dateStr = _formatNoteDate(note.updatedAt);

    // Kind badge color
    Color badgeBg = AppTheme.background;
    Color badgeTextColor = AppTheme.textSecondary;
    String badgeText = 'NOTE';
    if (note.kind == 'research') {
      badgeBg = const Color(0xFF8B5CF6).withValues(alpha: 0.18);
      badgeTextColor = const Color(0xFFA78BFA);
      badgeText = 'RESEARCH';
    } else if (note.kind == 'specialized') {
      badgeBg = const Color(0xFF10B981).withValues(alpha: 0.18);
      badgeTextColor = const Color(0xFF34D399);
      badgeText = 'SPECIALIZED';
    }
    if (note.isLocal) {
      badgeBg = Colors.amber.withValues(alpha: 0.15);
      badgeTextColor = Colors.amber;
      badgeText = 'NOT SYNCED';
    }

    // Swipe right: favorite (or restore, in trash). Swipe left: trash (or
    // delete forever, in trash).
    return Dismissible(
      key: ValueKey('note-${note.id}'),
      // Unsynced notes are managed from their page (discard), not by swiping.
      direction: note.isLocal ? DismissDirection.none : DismissDirection.horizontal,
      background: _swipeBackground(
        alignment: Alignment.centerLeft,
        color: isTrash ? AppTheme.accent : Colors.amber,
        icon: isTrash ? Icons.restore_rounded : (note.favorite ? Icons.star_outline_rounded : Icons.star_rounded),
      ),
      secondaryBackground: _swipeBackground(
        alignment: Alignment.centerRight,
        color: Colors.redAccent,
        icon: isTrash ? Icons.delete_forever_rounded : Icons.delete_outline_rounded,
      ),
      confirmDismiss: (direction) async {
        if (direction == DismissDirection.startToEnd) {
          if (isTrash) {
            await _restoreNote(note);
          } else {
            await _toggleFavorite(note);
          }
          return false;
        }
        if (isTrash) {
          await _deletePermanently(note); // asks first
          return false;
        }
        return true;
      },
      onDismissed: (_) => _trashWithUndo(note),
      child: _buildNoteCardBody(note, isTrash, dateStr, badgeBg, badgeTextColor, badgeText),
    );
  }

  Widget _swipeBackground({required Alignment alignment, required Color color, required IconData icon}) => Container(
        margin: const EdgeInsets.only(bottom: 12),
        alignment: alignment,
        padding: const EdgeInsets.symmetric(horizontal: 24),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.85), borderRadius: BorderRadius.circular(16)),
        child: Icon(icon, color: Colors.white),
      );

  Widget _buildNoteCardBody(Note note, bool isTrash, String dateStr, Color badgeBg, Color badgeTextColor, String badgeText) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(
          color: note.favorite ? Colors.amber.withValues(alpha: 0.3) : AppTheme.surfaceBorder,
          width: note.favorite ? 1.2 : 1,
        ),
      ),
      child: InkWell(
        onTap: () async {
          if (isTrash) return;
          final result = await Navigator.push(
            context,
            MaterialPageRoute(
              builder: (context) => NoteDetailView(note: note),
            ),
          );
          if (result == true) {
            _loadNotes();
          }
        },
        child: Padding(
          padding: const EdgeInsets.all(16.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Top row: Kind badge + Favorite / Trash actions
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: badgeBg,
                      borderRadius: BorderRadius.circular(6),
                      border: Border.all(color: badgeTextColor.withValues(alpha: 0.3)),
                    ),
                    child: Text(
                      badgeText,
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                        color: badgeTextColor,
                        letterSpacing: 0.5,
                      ),
                    ),
                  ),
                  const Spacer(),
                  if (isTrash) ...[
                    IconButton(
                      icon: const Icon(Icons.restore_from_trash_rounded, color: AppTheme.accent, size: 20),
                      tooltip: 'Restore',
                      onPressed: () => _restoreNote(note),
                    ),
                    IconButton(
                      icon: const Icon(Icons.delete_forever_rounded, color: Colors.redAccent, size: 20),
                      tooltip: 'Delete permanently',
                      onPressed: () => _deletePermanently(note),
                    ),
                  ] else ...[
                    IconButton(
                      icon: Icon(
                        note.favorite ? Icons.star_rounded : Icons.star_outline_rounded,
                        color: note.favorite ? Colors.amber : AppTheme.textSecondary,
                        size: 22,
                      ),
                      onPressed: () => _toggleFavorite(note),
                    ),
                  ],
                ],
              ),
              const SizedBox(height: 8),

              // Title
              Text(
                note.title.isEmpty ? 'Untitled note' : note.title,
                style: const TextStyle(
                  color: AppTheme.textPrimary,
                  fontSize: 17,
                  fontWeight: FontWeight.w700,
                  letterSpacing: -0.2,
                ),
              ),
              const SizedBox(height: 6),

              // Excerpt (Clean, well-spaced preview)
              if (note.plainText.isNotEmpty)
                Text(
                  note.plainText,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: 13.5,
                    height: 1.45,
                  ),
                ),

              const SizedBox(height: 14),

              // Bottom footer: Tags + Date + Chevron
              Row(
                children: [
                  if (note.tags.isNotEmpty)
                    Expanded(
                      child: Wrap(
                        spacing: 6,
                        children: note.tags.take(3).map((tag) => Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                          decoration: BoxDecoration(
                            color: AppTheme.background,
                            borderRadius: BorderRadius.circular(6),
                            border: Border.all(color: AppTheme.surfaceBorder),
                          ),
                          child: Text(
                            '#$tag',
                            style: const TextStyle(
                              color: AppTheme.primaryLight,
                              fontSize: 11,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        )).toList(),
                      ),
                    )
                  else
                    const Spacer(),

                  // Date
                  Text(
                    dateStr,
                    style: TextStyle(
                      fontSize: 11.5,
                      color: AppTheme.textSecondary.withValues(alpha: 0.7),
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  if (!isTrash) ...[
                    const SizedBox(width: 6),
                    const Icon(Icons.chevron_right_rounded, size: 16, color: AppTheme.textSecondary),
                  ],
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    IconData icon = Icons.notes_rounded;
    String title = 'No notes yet';
    String message = 'Create your first note to start capturing your thoughts.';

    if (_search.isNotEmpty) {
      icon = Icons.search_off_rounded;
      title = 'No matching notes';
      message = 'Try searching with a different keyword or tag.';
    } else if (_currentScope == 'favorites') {
      icon = Icons.star_border_rounded;
      title = 'No favorites yet';
      message = 'Star notes in your workspace to pin them here.';
    } else if (_currentScope == 'archive') {
      icon = Icons.archive_outlined;
      title = 'Archive is empty';
      message = 'Archived notes will appear in this section.';
    } else if (_currentScope == 'trash') {
      icon = Icons.delete_outline_rounded;
      title = 'Trash is empty';
      message = 'Notes you move to trash will be stored here safely.';
    }

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32.0),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 48, color: AppTheme.textSecondary.withValues(alpha: 0.35)),
            const SizedBox(height: 14),
            Text(
              title,
              style: const TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.bold,
                color: AppTheme.textPrimary,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary, height: 1.4),
            ),
            const SizedBox(height: 20),
            if (_search.isNotEmpty)
              OutlinedButton.icon(
                onPressed: () => setState(() => _search = ''),
                icon: const Icon(Icons.clear, size: 16),
                label: const Text('Clear search'),
              )
            else if (_currentScope == 'all')
              ElevatedButton.icon(
                onPressed: _showCreateNoteSheet,
                icon: const Icon(Icons.add, size: 18),
                label: const Text('Create a note'),
              ),
          ],
        ),
      ),
    );
  }

  String _formatNoteDate(String isoString) {
    if (isoString.isEmpty) return '';
    try {
      final dt = DateTime.parse(isoString).toLocal();
      return DateFormat('MMM d').format(dt);
    } catch (_) {
      return '';
    }
  }
}
