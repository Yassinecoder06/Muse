import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../data/models/note.dart';
import '../../data/services/api_service.dart';
import '../../data/services/app_events.dart';
import '../../data/services/note_store.dart';
import '../../data/services/offline_queue.dart';
import '../../data/services/storage_service.dart';
import '../theme/app_theme.dart';
import '../widgets/specialized_note_sheet.dart';
import 'note_detail_view.dart';

class NotesTab extends StatefulWidget {
  const NotesTab({super.key});

  @override
  State<NotesTab> createState() => _NotesTabState();
}

class _NotesTabState extends State<NotesTab> {
  final ApiService _api = ApiService();
  final StorageService _storage = StorageService();

  List<Note> _allNotes = [];
  bool _loading = true;
  String _search = '';
  String? _error;
  bool _offline = false;
  String _userName = 'Explorer';

  // Multi-select state matching web client
  final Set<String> _selectedIds = {};
  bool get _isSelectionMode => _selectedIds.isNotEmpty;

  // Server search (keywords + meaning) for the "all" scope; null = not run.
  final _searchController = TextEditingController();
  Timer? _searchDebounce;
  List<Note>? _searchResults;
  String _searchResultsFor = '';
  bool _searching = false;

  // Scopes matching web: 'all', 'favorites', 'archive', 'trash'
  String _currentScope = 'all';

  @override
  void initState() {
    super.initState();
    _loadUserName();
    _loadNotes();
    AppEvents.dataChanged.addListener(_onDataChanged);
    AppEvents.notesScope.addListener(_onScopeChanged);
  }

  void _onScopeChanged() {
    final s = AppEvents.notesScope.value;
    if (mounted && _currentScope != s) {
      _setScope(s);
    }
  }

  Future<void> _loadUserName() async {
    final name = await _storage.getUserName();
    if (mounted) setState(() => _userName = name);
  }

  @override
  void dispose() {
    AppEvents.dataChanged.removeListener(_onDataChanged);
    AppEvents.notesScope.removeListener(_onScopeChanged);
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

  void _onDataChanged() => _loadNotes(silent: true);

  Future<void> _loadNotes({bool silent = false}) async {
    if (!silent) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final result = await NoteStore.list(_api, _currentScope);
      if (!mounted) return;
      setState(() {
        _allNotes = result.notes;
        _offline = result.offline;
        _loading = false;
        // Clean up selected IDs that no longer exist
        final existingIds = result.notes.map((n) => n.id).toSet();
        _selectedIds.removeWhere((id) => !existingIds.contains(id));
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
    if (AppEvents.notesScope.value != scope) {
      AppEvents.notesScope.value = scope;
    }
    setState(() {
      _currentScope = scope;
      _selectedIds.clear();
    });
    await _loadNotes();
  }

  // --- Multi-select actions ---
  void _toggleSelect(String id) {
    setState(() {
      if (_selectedIds.contains(id)) {
        _selectedIds.remove(id);
      } else {
        _selectedIds.add(id);
      }
    });
  }

  void _selectAll(List<Note> list) {
    setState(() {
      _selectedIds.addAll(list.map((n) => n.id));
    });
  }

  void _clearSelection() {
    setState(() {
      _selectedIds.clear();
    });
  }

  Future<void> _trashSelected() async {
    final ids = _selectedIds.toList();
    if (ids.isEmpty) return;

    final count = ids.length;
    final toRemove = _allNotes.where((n) => ids.contains(n.id)).toList();

    setState(() {
      _allNotes.removeWhere((n) => ids.contains(n.id));
      _selectedIds.clear();
    });

    final messenger = ScaffoldMessenger.of(context);
    try {
      for (final id in ids) {
        await _api.deleteNote(id);
      }
      messenger.showSnackBar(
        SnackBar(
          content: Text('$count note${count == 1 ? '' : 's'} moved to trash'),
          duration: const Duration(seconds: 4),
          action: SnackBarAction(
            label: 'Undo',
            onPressed: () async {
              for (final note in toRemove) {
                try {
                  await _api.restoreNote(note.id);
                } catch (_) {}
              }
              _loadNotes(silent: true);
            },
          ),
        ),
      );
    } catch (e) {
      _loadNotes(silent: true);
      messenger.showSnackBar(
        SnackBar(content: Text('Failed to move to trash: $e'), backgroundColor: Colors.redAccent),
      );
    }
  }

  Future<void> _restoreSelected() async {
    final ids = _selectedIds.toList();
    if (ids.isEmpty) return;

    final count = ids.length;
    setState(() {
      _allNotes.removeWhere((n) => ids.contains(n.id));
      _selectedIds.clear();
    });

    try {
      for (final id in ids) {
        await _api.restoreNote(id);
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('$count note${count == 1 ? '' : 's'} restored to workspace')),
        );
      }
    } catch (e) {
      _loadNotes(silent: true);
    }
  }

  Future<void> _deletePermanentlySelected() async {
    final ids = _selectedIds.toList();
    if (ids.isEmpty) return;

    final count = ids.length;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.getSurface(ctx),
        title: Text('Permanently delete $count note${count == 1 ? '' : 's'}?',
            style: TextStyle(color: AppTheme.getTextPrimary(ctx))),
        content: Text(
          'This action cannot be undone. The selected notes will be destroyed permanently.',
          style: TextStyle(color: AppTheme.getTextSecondary(ctx)),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text('Cancel', style: TextStyle(color: AppTheme.getTextSecondary(ctx))),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.redAccent),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete permanently', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    setState(() {
      _allNotes.removeWhere((n) => ids.contains(n.id));
      _selectedIds.clear();
    });

    try {
      for (final id in ids) {
        await _api.deleteNotePermanently(id);
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('$count note${count == 1 ? '' : 's'} permanently deleted')),
        );
      }
    } catch (e) {
      _loadNotes(silent: true);
    }
  }

  // --- Single note actions ---
  Future<void> _toggleFavorite(Note note) async {
    final nextFav = !note.favorite;
    setState(() {
      final index = _allNotes.indexWhere((n) => n.id == note.id);
      if (index != -1) {
        _allNotes[index] = note.copyWith(favorite: nextFav);
      }
    });

    try {
      await NoteStore.save(_api, note, favorite: nextFav);
    } catch (_) {
      setState(() {
        final index = _allNotes.indexWhere((n) => n.id == note.id);
        if (index != -1) {
          _allNotes[index] = note.copyWith(favorite: !nextFav);
        }
      });
    }
  }

  Future<void> _trashWithUndo(Note note) async {
    final index = _allNotes.indexWhere((n) => n.id == note.id);
    setState(() => _allNotes.removeWhere((n) => n.id == note.id));
    final messenger = ScaffoldMessenger.of(context);
    try {
      await _api.deleteNote(note.id);
    } catch (e) {
      if (!mounted) return;
      setState(() => _allNotes.insert(index.clamp(0, _allNotes.length), note));
      messenger.showSnackBar(
        SnackBar(content: Text('Could not move to trash: $e'), backgroundColor: Colors.redAccent),
      );
      return;
    }
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      SnackBar(
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
      ),
    );
  }

  Future<void> _restoreNote(Note note) async {
    try {
      await _api.restoreNote(note.id);
      setState(() => _allNotes.removeWhere((n) => n.id == note.id));
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
        backgroundColor: AppTheme.getSurface(ctx),
        title: Text('Delete permanently?', style: TextStyle(color: AppTheme.getTextPrimary(ctx))),
        content: Text(
          'This note will be permanently erased and cannot be recovered.',
          style: TextStyle(color: AppTheme.getTextSecondary(ctx)),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text('Cancel', style: TextStyle(color: AppTheme.getTextSecondary(ctx))),
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
        setState(() => _allNotes.removeWhere((n) => n.id == note.id));
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

  Future<void> _createWeeklyReflection() async {
    try {
      final n = await _api.createNote(
        title: 'Weekly Reflection - ${DateFormat('MMM d').format(DateTime.now())}',
        content: '## Weekly Reflection\n\n### What gave me energy this week?\n\n### What do I want more of?\n',
        tags: ['rituals', 'personal'],
      );
      await _loadNotes();
      if (!mounted) return;
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => NoteDetailView(note: n)));
    } catch (_) {}
  }

  Future<void> _emptyTrash() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.getSurface(ctx),
        title: Text('Empty Trash?', style: TextStyle(color: AppTheme.getTextPrimary(ctx))),
        content: Text(
          'Every note in the trash will be permanently destroyed.',
          style: TextStyle(color: AppTheme.getTextSecondary(ctx)),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text('Cancel', style: TextStyle(color: AppTheme.getTextSecondary(ctx))),
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

  Future<void> _createAndOpenNote(BuildContext ctx) async {
    try {
      Note created;
      try {
        created = await _api.createNote(
          title: '',
          content: '',
          tags: ['mobile'],
        );
      } catch (e) {
        if (!OfflineQueue.isNetworkError(e)) rethrow;
        created = await OfflineQueue.queueNote(
          title: '',
          content: '',
          tags: ['mobile'],
        );
      }
      if (!mounted) return;
      await Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => NoteDetailView(
            note: created,
            initialEditMode: true,
          ),
        ),
      );
      _loadNotes(silent: true);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to create note: $e'), backgroundColor: Colors.redAccent),
      );
    }
  }

  void _showCreateNoteSheet() {
    _createAndOpenNote(context);
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

    // Section title matching web
    final heading = _currentScope == 'favorites'
        ? 'Favorite notes'
        : _currentScope == 'archive'
            ? 'Archived notes'
            : _currentScope == 'trash'
                ? 'Trash'
                : 'Recent notes';

    // Greeting matching web
    final greeting = now.hour < 12
        ? 'Good morning, $_userName.'
        : now.hour < 18
            ? 'Good afternoon, $_userName.'
            : 'Good evening, $_userName.';

    return Scaffold(
      backgroundColor: AppTheme.getBackground(context),
      floatingActionButton: _isSelectionMode
          ? null
          : Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                FloatingActionButton.small(
                  heroTag: 'fab_template',
                  onPressed: () => SpecializedNoteSheet.show(context),
                  backgroundColor: AppTheme.getSurface(context),
                  tooltip: 'Specialized Template',
                  child: const Icon(Icons.layers_outlined, color: Color(0xFF00E5FF), size: 20),
                ),
                const SizedBox(height: 10),
                FloatingActionButton(
                  heroTag: 'fab_new_note',
                  onPressed: _showCreateNoteSheet,
                  tooltip: 'New Note',
                  child: const Icon(Icons.add_rounded, size: 26),
                ),
              ],
            ),
      body: RefreshIndicator(
        onRefresh: _loadNotes,
        color: AppTheme.primaryLight,
        child: CustomScrollView(
          slivers: [
            // Hero Header matching Web Client Dashboard
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      todayStr.toUpperCase(),
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: AppTheme.getTextSecondary(context).withValues(alpha: 0.8),
                        letterSpacing: 0.8,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Expanded(
                          child: Text(
                            greeting,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 22,
                              fontWeight: FontWeight.w800,
                              color: AppTheme.getTextPrimary(context),
                              letterSpacing: -0.4,
                            ),
                          ),
                        ),
                        // Quick Specialized Button matching web Hero Action
                        OutlinedButton.icon(
                          style: OutlinedButton.styleFrom(
                            side: BorderSide(color: AppTheme.getSurfaceBorder(context)),
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                          ),
                          onPressed: () => SpecializedNoteSheet.show(context),
                          icon: const Icon(Icons.layers_rounded, size: 16, color: AppTheme.primaryLight),
                          label: Text(
                            'Specialized',
                            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppTheme.getTextPrimary(context)),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'A quiet space for your thoughts.',
                      style: TextStyle(fontSize: 13, color: AppTheme.getTextSecondary(context)),
                    ),
                  ],
                ),
              ),
            ),

            // Scope Filter Navigation Strip (All, Favorites, Archive, Trash)
            SliverToBoxAdapter(
              child: SizedBox(
                height: 46,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  children: [
                    _buildScopeChip(
                      id: 'all',
                      label: 'All notes',
                      icon: Icons.description_outlined,
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
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(18, 6, 18, 0),
                  child: Row(
                    children: [
                      const Icon(Icons.cloud_off_rounded, size: 15, color: Colors.amber),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'Offline: showing local copy. Edits will sync when connected.',
                          style: TextStyle(fontSize: 11.5, color: Colors.amber.shade400),
                        ),
                      ),
                    ],
                  ),
                ),
              ),

            // Search Bar matching web topbar search
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(18, 10, 18, 10),
                child: TextField(
                  controller: _searchController,
                  style: TextStyle(color: AppTheme.getTextPrimary(context), fontSize: 13.5),
                  onChanged: _onSearchChanged,
                  decoration: InputDecoration(
                    hintText: _currentScope == 'all' ? 'Search your notes…' : 'Search title or tag…',
                    hintStyle: TextStyle(color: AppTheme.getTextSecondary(context), fontSize: 13),
                    prefixIcon: _searching
                        ? const Padding(
                            padding: EdgeInsets.all(12),
                            child: SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.primaryLight)),
                          )
                        : Icon(Icons.search, color: AppTheme.getTextSecondary(context), size: 19),
                    suffixIcon: _search.isNotEmpty
                        ? IconButton(
                            icon: Icon(Icons.close, color: AppTheme.getTextSecondary(context), size: 17),
                            onPressed: _clearSearch,
                          )
                        : null,
                    filled: true,
                    fillColor: AppTheme.getSurface(context),
                    contentPadding: const EdgeInsets.symmetric(vertical: 8, horizontal: 14),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: BorderSide(color: AppTheme.getSurfaceBorder(context)),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: BorderSide(color: AppTheme.getSurfaceBorder(context)),
                    ),
                  ),
                ),
              ),
            ),

            // List Heading & Multi-Select Toolbar matching web Dashboard
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
                child: _isSelectionMode
                    ? Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        decoration: BoxDecoration(
                          color: AppTheme.getSurface(context),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: AppTheme.primaryLight.withValues(alpha: 0.5)),
                        ),
                        child: Row(
                          children: [
                            Text(
                              '${_selectedIds.length} selected',
                              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppTheme.getTextPrimary(context)),
                            ),
                            const Spacer(),
                            TextButton(
                              onPressed: () => _selectAll(filtered),
                              child: const Text('Select all', style: TextStyle(fontSize: 12)),
                            ),
                            TextButton(
                              onPressed: _clearSelection,
                              child: const Text('Deselect', style: TextStyle(fontSize: 12)),
                            ),
                            if (_currentScope == 'trash') ...[
                              IconButton(
                                icon: const Icon(Icons.restore_from_trash_rounded, color: AppTheme.accent, size: 20),
                                tooltip: 'Restore selected',
                                onPressed: _restoreSelected,
                              ),
                              IconButton(
                                icon: const Icon(Icons.delete_forever_rounded, color: Colors.redAccent, size: 20),
                                tooltip: 'Delete permanently',
                                onPressed: _deletePermanentlySelected,
                              ),
                            ] else ...[
                              IconButton(
                                icon: const Icon(Icons.delete_outline_rounded, color: Colors.redAccent, size: 20),
                                tooltip: 'Move selected to trash',
                                onPressed: _trashSelected,
                              ),
                            ],
                          ],
                        ),
                      )
                    : Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Row(
                            children: [
                              Text(
                                heading,
                                style: TextStyle(
                                  fontSize: 15,
                                  fontWeight: FontWeight.bold,
                                  color: AppTheme.getTextPrimary(context),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                                decoration: BoxDecoration(
                                  color: AppTheme.getSurfaceBorder(context).withValues(alpha: 0.5),
                                  borderRadius: BorderRadius.circular(10),
                                ),
                                child: Text(
                                  '${filtered.length}',
                                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppTheme.getTextSecondary(context)),
                                ),
                              ),
                            ],
                          ),
                          if (filtered.isNotEmpty)
                            TextButton.icon(
                              style: TextButton.styleFrom(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                              ),
                              onPressed: () {
                                if (filtered.isNotEmpty) {
                                  _toggleSelect(filtered.first.id);
                                }
                              },
                              icon: Icon(Icons.check_box_outlined, size: 14, color: AppTheme.getTextSecondary(context)),
                              label: Text(
                                'Select',
                                style: TextStyle(fontSize: 12, color: AppTheme.getTextSecondary(context)),
                              ),
                            ),
                          if (_currentScope == 'trash' && _allNotes.isNotEmpty)
                            TextButton(
                              onPressed: _emptyTrash,
                              child: const Text('Empty Trash', style: TextStyle(fontSize: 12, color: Colors.redAccent, fontWeight: FontWeight.bold)),
                            ),
                        ],
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
                        Text(_error!, textAlign: TextAlign.center, style: TextStyle(color: AppTheme.getTextSecondary(context))),
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
              // Note Grid/List matching web .note-card layout
              SliverPadding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                sliver: SliverList(
                  delegate: SliverChildBuilderDelegate(
                    (context, index) => _buildNoteCard(filtered[index]),
                    childCount: filtered.length,
                  ),
                ),
              ),

              // Pinned Reflection Section matching Web Dashboard
              if (_currentScope == 'all' && _search.isEmpty) ...[
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(20, 20, 20, 8),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'PINNED',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 0.8,
                            color: AppTheme.getTextSecondary(context),
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          'Your favorite thoughts, close at hand',
                          style: TextStyle(fontSize: 12, color: AppTheme.getTextSecondary(context)),
                        ),
                      ],
                    ),
                  ),
                ),
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 80),
                    child: Card(
                      color: AppTheme.getSurface(context),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(16),
                        side: BorderSide(color: AppTheme.getSurfaceBorder(context)),
                      ),
                      child: InkWell(
                        borderRadius: BorderRadius.circular(16),
                        onTap: () {
                          // Quick open or create a reflection note
                          showDialog(
                            context: context,
                            builder: (ctx) => AlertDialog(
                              backgroundColor: AppTheme.getSurface(ctx),
                              title: const Row(
                                children: [
                                  Icon(Icons.auto_awesome, color: AppTheme.primaryLight, size: 20),
                                  SizedBox(width: 8),
                                  Text('Weekly Reflection'),
                                ],
                              ),
                              content: const Text(
                                'What gave you energy this week? What do you want more of?',
                                style: TextStyle(fontSize: 14),
                              ),
                              actions: [
                                TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close')),
                                ElevatedButton(
                                  style: ElevatedButton.styleFrom(backgroundColor: AppTheme.primary),
                                  onPressed: () {
                                    Navigator.pop(ctx);
                                    _createWeeklyReflection();
                                  },
                                  child: const Text('Write Reflection', style: TextStyle(color: Colors.white)),
                                ),
                              ],
                            ),
                          );
                        },
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Container(
                                padding: const EdgeInsets.all(8),
                                decoration: BoxDecoration(
                                  color: AppTheme.primary.withValues(alpha: 0.15),
                                  shape: BoxShape.circle,
                                ),
                                child: const Icon(Icons.auto_awesome, color: AppTheme.primaryLight, size: 18),
                              ),
                              const SizedBox(width: 14),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      'Weekly reflection',
                                      style: TextStyle(
                                        fontSize: 15,
                                        fontWeight: FontWeight.bold,
                                        color: AppTheme.getTextPrimary(context),
                                      ),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      'What gave me energy this week? What do I want more of?',
                                      style: TextStyle(fontSize: 13, color: AppTheme.getTextSecondary(context)),
                                    ),
                                    const SizedBox(height: 8),
                                    Wrap(
                                      spacing: 6,
                                      children: [
                                        _buildTagPill('rituals'),
                                        _buildTagPill('personal'),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                              Icon(Icons.north_east_rounded, size: 16, color: AppTheme.getTextSecondary(context)),
                            ],
                          ),
                        ),
                      ),
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

  Widget _buildTagPill(String tag) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: AppTheme.getBackground(context),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: AppTheme.getSurfaceBorder(context)),
      ),
      child: Text(
        '#$tag',
        style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w500, color: AppTheme.primaryLight),
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
          color: isSelected ? Colors.white : (iconColor ?? AppTheme.getTextSecondary(context)),
        ),
        label: Text(
          count != null ? '$label ($count)' : label,
          style: TextStyle(
            fontSize: 12,
            fontWeight: isSelected ? FontWeight.bold : FontWeight.w500,
            color: isSelected ? Colors.white : AppTheme.getTextPrimary(context),
          ),
        ),
        backgroundColor: AppTheme.getSurface(context),
        selectedColor: AppTheme.primary,
        side: BorderSide(
          color: isSelected ? AppTheme.primaryLight : AppTheme.getSurfaceBorder(context),
          width: 1,
        ),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        onSelected: (_) => _setScope(id),
      ),
    );
  }

  Widget _buildNoteCard(Note note) {
    final isTrash = _currentScope == 'trash';
    final isSelected = _selectedIds.contains(note.id);
    final dateStr = _formatNoteDate(note.updatedAt);

    // Kind badge color matching web
    Color badgeBg = AppTheme.getBackground(context);
    Color badgeTextColor = AppTheme.getTextSecondary(context);
    String badgeText = '';

    if (note.kind == 'research') {
      badgeBg = const Color(0xFF059669).withValues(alpha: 0.16);
      badgeTextColor = const Color(0xFF10B981);
      badgeText = 'Research';
    } else if (note.kind == 'specialized') {
      badgeBg = const Color(0xFF7C3AED).withValues(alpha: 0.16);
      badgeTextColor = const Color(0xFFA78BFA);
      badgeText = 'Specialized';
    }
    if (note.isLocal) {
      badgeBg = Colors.amber.withValues(alpha: 0.15);
      badgeTextColor = Colors.amber;
      badgeText = 'Not synced';
    }

    return Dismissible(
      key: ValueKey('note-${note.id}'),
      direction: note.isLocal || _isSelectionMode ? DismissDirection.none : DismissDirection.horizontal,
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
          await _deletePermanently(note);
          return false;
        }
        return true;
      },
      onDismissed: (_) => _trashWithUndo(note),
      child: Card(
        margin: const EdgeInsets.only(bottom: 12),
        color: AppTheme.getSurface(context),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(
            color: isSelected
                ? AppTheme.primaryLight
                : note.favorite
                    ? Colors.amber.withValues(alpha: 0.35)
                    : AppTheme.getSurfaceBorder(context),
            width: isSelected || note.favorite ? 1.5 : 1,
          ),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () async {
            if (_isSelectionMode) {
              _toggleSelect(note.id);
              return;
            }
            if (isTrash) return;
            final result = await Navigator.push(
              context,
              MaterialPageRoute(builder: (context) => NoteDetailView(note: note)),
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
                // Top row: Selection check / Badge + Favorite star / Trash actions
                Row(
                  children: [
                    if (_isSelectionMode)
                      Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: Icon(
                          isSelected ? Icons.check_box_rounded : Icons.check_box_outline_blank_rounded,
                          color: isSelected ? AppTheme.primaryLight : AppTheme.getTextSecondary(context),
                          size: 20,
                        ),
                      ),
                    if (badgeText.isNotEmpty)
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
                            fontSize: 10.5,
                            fontWeight: FontWeight.bold,
                            color: badgeTextColor,
                            letterSpacing: 0.3,
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
                          color: note.favorite ? Colors.amber : AppTheme.getTextSecondary(context),
                          size: 22,
                        ),
                        onPressed: () => _toggleFavorite(note),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 8),

                // Note Title
                Text(
                  note.title.isEmpty ? 'Untitled note' : note.title,
                  style: TextStyle(
                    color: AppTheme.getTextPrimary(context),
                    fontSize: 16.5,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -0.2,
                  ),
                ),
                const SizedBox(height: 6),

                // Excerpt snippet
                if (note.plainText.isNotEmpty)
                  Text(
                    note.plainText,
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: AppTheme.getTextSecondary(context),
                      fontSize: 13.5,
                      height: 1.45,
                    ),
                  ),

                const SizedBox(height: 12),

                // Footer: Tag pills & Formatted Date
                Row(
                  children: [
                    if (note.tags.isNotEmpty)
                      Expanded(
                        child: Wrap(
                          spacing: 6,
                          children: note.tags.take(3).map((tag) => _buildTagPill(tag)).toList(),
                        ),
                      )
                    else
                      const Spacer(),

                    Text(
                      dateStr,
                      style: TextStyle(
                        fontSize: 11.5,
                        color: AppTheme.getTextSecondary(context).withValues(alpha: 0.7),
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    if (!isTrash && !_isSelectionMode) ...[
                      const SizedBox(width: 4),
                      Icon(Icons.chevron_right_rounded, size: 16, color: AppTheme.getTextSecondary(context)),
                    ],
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _swipeBackground({required Alignment alignment, required Color color, required IconData icon}) => Container(
        margin: const EdgeInsets.only(bottom: 12),
        alignment: alignment,
        padding: const EdgeInsets.symmetric(horizontal: 24),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.85), borderRadius: BorderRadius.circular(16)),
        child: Icon(icon, color: Colors.white),
      );

  Widget _buildEmptyState() {
    IconData icon = Icons.description_outlined;
    String title = 'No notes yet';
    String message = 'Create your first note to start capturing your thoughts.';

    if (_search.isNotEmpty) {
      icon = Icons.search_off_rounded;
      title = 'No matching notes';
      message = 'Try searching with a different keyword or tag.';
    } else if (_currentScope == 'favorites') {
      icon = Icons.star_border_rounded;
      title = 'No favorites yet';
      message = 'Star your favorite notes to keep them close at hand.';
    } else if (_currentScope == 'archive') {
      icon = Icons.archive_outlined;
      title = 'Archive is empty';
      message = 'Archived notes will be stored here.';
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
            Icon(icon, size: 48, color: AppTheme.getTextSecondary(context).withValues(alpha: 0.35)),
            const SizedBox(height: 14),
            Text(
              title,
              style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.bold,
                color: AppTheme.getTextPrimary(context),
              ),
            ),
            const SizedBox(height: 6),
            Text(
              message,
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 13, color: AppTheme.getTextSecondary(context), height: 1.4),
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
                style: ElevatedButton.styleFrom(backgroundColor: AppTheme.primary, foregroundColor: Colors.white),
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
