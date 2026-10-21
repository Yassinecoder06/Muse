import 'dart:async';
import 'dart:io';
import 'dart:math';
import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';
import '../../data/services/api_service.dart';
import '../../data/services/app_events.dart';
import '../../data/services/music_service.dart';
import '../theme/app_theme.dart';
import '../widgets/bip_voice_sheet.dart';

class MusicTab extends StatefulWidget {
  const MusicTab({super.key});

  @override
  State<MusicTab> createState() => _MusicTabState();
}

class _MusicTabState extends State<MusicTab> {
  final ApiService _api = ApiService();
  final MusicService _music = MusicService.instance;

  int _currentSection = 0; // 0 = Library, 1 = Playlists, 2 = Downloader

  // Library State
  List<Map<String, dynamic>> _songs = [];
  bool _loadingSongs = true;
  String _songSearch = '';
  final _searchController = TextEditingController();

  // Playlists State
  List<Map<String, dynamic>> _playlists = [];
  bool _loadingPlaylists = true;

  // Downloader State
  List<Map<String, dynamic>> _tasks = [];
  bool _loadingTasks = true;
  final _downloadUrlController = TextEditingController();
  bool _submittingDownload = false;
  Timer? _tasksPollTimer;

  @override
  void initState() {
    super.initState();
    _loadAll();
    AppEvents.dataChanged.addListener(_onDataChanged);

    // Poll download tasks every 3 seconds while on Downloader tab
    _tasksPollTimer = Timer.periodic(const Duration(seconds: 3), (_) {
      if (mounted && _currentSection == 2) {
        _loadTasks(silent: true);
      }
    });
  }

  @override
  void dispose() {
    AppEvents.dataChanged.removeListener(_onDataChanged);
    _tasksPollTimer?.cancel();
    _searchController.dispose();
    _downloadUrlController.dispose();
    super.dispose();
  }

  void _onDataChanged() {
    _loadAll(silent: true);
  }

  Future<void> _loadAll({bool silent = false}) async {
    await Future.wait([
      _loadSongs(silent: silent),
      _loadPlaylists(silent: silent),
      _loadTasks(silent: silent),
    ]);
  }

  Future<void> _loadSongs({bool silent = false}) async {
    if (!silent) setState(() => _loadingSongs = true);

    // Show cached songs right away so offline opening has instant content
    try {
      final cached = await _music.loadSongsCache();
      if (cached != null && cached.isNotEmpty && mounted) {
        setState(() {
          _songs = cached;
          _loadingSongs = false;
        });
      }
    } catch (_) {}

    try {
      final list = await _api.fetchMusicSongs();
      if (mounted) {
        setState(() {
          _songs = list;
          _loadingSongs = false;
        });
        await _music.saveSongsCache(list);
      }
    } catch (_) {
      // Offline fallback: load cache if not already loaded
      if (_songs.isEmpty) {
        final cached = await _music.loadSongsCache();
        if (cached != null && mounted) {
          setState(() {
            _songs = cached;
            _loadingSongs = false;
          });
        }
      }
      if (mounted && !silent) setState(() => _loadingSongs = false);
    }
  }

  Future<void> _loadPlaylists({bool silent = false}) async {
    if (!silent) setState(() => _loadingPlaylists = true);
    try {
      final list = await _api.fetchMusicPlaylists();
      if (mounted) {
        setState(() {
          _playlists = list;
          _loadingPlaylists = false;
        });
      }
    } catch (_) {
      if (mounted && !silent) setState(() => _loadingPlaylists = false);
    }
  }

  Future<void> _loadTasks({bool silent = false}) async {
    if (!silent) setState(() => _loadingTasks = true);
    try {
      final list = await _api.fetchMusicTasks();
      if (mounted) {
        setState(() {
          _tasks = list;
          _loadingTasks = false;
        });
      }
    } catch (_) {
      if (mounted && !silent) setState(() => _loadingTasks = false);
    }
  }

  Future<void> _deleteSong(String filename, String title) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.getSurface(ctx),
        title: Text('Delete Song?', style: TextStyle(color: AppTheme.getTextPrimary(ctx))),
        content: Text(
          'Are you sure you want to delete "$title" from your remote library?',
          style: TextStyle(color: AppTheme.getTextSecondary(ctx)),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.redAccent),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      try {
        if (_music.currentTrack.value?['filename'] == filename) {
          await _music.stop();
        }
        await _api.deleteMusicSong(filename);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Deleted "$title"')),
          );
          _loadSongs(silent: true);
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Failed to delete song: $e'), backgroundColor: Colors.redAccent),
          );
        }
      }
    }
  }

  Future<void> _createNewPlaylist() async {
    final nameCtrl = TextEditingController();
    final created = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.getSurface(ctx),
        title: Text('New Playlist', style: TextStyle(color: AppTheme.getTextPrimary(ctx))),
        content: TextField(
          controller: nameCtrl,
          autofocus: true,
          decoration: const InputDecoration(
            labelText: 'Playlist Name',
            hintText: 'e.g. Focus Beats, Workout 2026',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Create'),
          ),
        ],
      ),
    );

    if (created == true && nameCtrl.text.trim().isNotEmpty) {
      try {
        await _api.createMusicPlaylist(nameCtrl.text.trim());
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Created playlist "${nameCtrl.text.trim()}"')),
          );
          _loadPlaylists(silent: true);
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Failed to create playlist: $e'), backgroundColor: Colors.redAccent),
          );
        }
      }
    }
  }

  Future<void> _deletePlaylist(String id, String name) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.getSurface(ctx),
        title: Text('Delete Playlist?', style: TextStyle(color: AppTheme.getTextPrimary(ctx))),
        content: Text(
          'Are you sure you want to delete playlist "$name"?',
          style: TextStyle(color: AppTheme.getTextSecondary(ctx)),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.redAccent),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      try {
        await _api.deleteMusicPlaylist(id);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Deleted playlist "$name"')),
          );
          _loadPlaylists(silent: true);
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Failed to delete playlist: $e'), backgroundColor: Colors.redAccent),
          );
        }
      }
    }
  }

  Future<void> _submitDownload() async {
    final raw = _downloadUrlController.text.trim();
    if (raw.isEmpty) return;

    setState(() => _submittingDownload = true);
    try {
      final items = [
        {'query': raw, 'title': raw.startsWith('http') ? 'Web Track' : raw}
      ];
      await _api.downloadMusic(items);
      _downloadUrlController.clear();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Download scheduled with music microservice!')),
        );
        _loadTasks(silent: true);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to download: $e'), backgroundColor: Colors.redAccent),
        );
      }
    } finally {
      if (mounted) setState(() => _submittingDownload = false);
    }
  }

  void _addSongToPlaylistModal(Map<String, dynamic> song) {
    if (_playlists.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Create a playlist first in the Playlists tab!')),
      );
      return;
    }

    final sTitle = song['title'] as String? ?? song['filename'] as String? ?? 'Song';

    showModalBottomSheet(
      context: context,
      backgroundColor: AppTheme.getSurface(context),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Add "$sTitle" to Playlist',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
                color: AppTheme.getTextPrimary(ctx),
              ),
            ),
            const SizedBox(height: 12),
            Flexible(
              child: ListView.builder(
                shrinkWrap: true,
                itemCount: _playlists.length,
                itemBuilder: (ctx, idx) {
                  final pl = _playlists[idx];
                  final id = pl['id'] as String? ?? '';
                  final name = pl['name'] as String? ?? 'Playlist';
                  final tracks = List<Map<String, dynamic>>.from(
                    (pl['tracks'] as List<dynamic>? ?? []).map((t) => Map<String, dynamic>.from(t as Map)),
                  );

                  return ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.playlist_add_rounded, color: AppTheme.primaryLight),
                    title: Text(name, style: TextStyle(color: AppTheme.getTextPrimary(ctx))),
                    subtitle: Text('${tracks.length} tracks', style: TextStyle(color: AppTheme.getTextSecondary(ctx), fontSize: 12)),
                    onTap: () async {
                      Navigator.pop(ctx);
                      tracks.add({
                        'filename': song['filename'],
                        'title': song['title'],
                        'artist': song['artist'],
                      });
                      try {
                        await _api.updateMusicPlaylist(id, tracks: tracks);
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text('Added to "$name"')),
                          );
                          _loadPlaylists(silent: true);
                        }
                      } catch (e) {
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text('Failed to add track: $e'), backgroundColor: Colors.redAccent),
                          );
                        }
                      }
                    },
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _showAddSongsToPlaylistPicker(Map<String, dynamic> playlist, StateSetter setModalState) {
    final playlistId = playlist['id'] as String? ?? '';
    final existingTracks = (playlist['tracks'] as List<dynamic>? ?? [])
        .map((t) => (t as Map)['filename'] as String? ?? '')
        .toSet();

    String search = '';

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.getSurface(context),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (sheetCtx) => StatefulBuilder(
        builder: (sheetCtx, setSheetState) {
          final filtered = _songs.where((s) {
            final t = (s['title'] as String? ?? s['filename'] as String? ?? '').toLowerCase();
            final a = (s['artist'] as String? ?? '').toLowerCase();
            final q = search.toLowerCase();
            return t.contains(q) || a.contains(q);
          }).toList();

          return Container(
            height: MediaQuery.of(context).size.height * 0.75,
            padding: const EdgeInsets.fromLTRB(20, 20, 20, 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      'Add Songs to Playlist',
                      style: TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.bold,
                        color: AppTheme.getTextPrimary(sheetCtx),
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close_rounded, size: 20),
                      onPressed: () => Navigator.pop(sheetCtx),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                TextField(
                  onChanged: (val) => setSheetState(() => search = val.trim()),
                  decoration: const InputDecoration(
                    hintText: 'Search songs…',
                    prefixIcon: Icon(Icons.search, size: 20),
                    contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  ),
                ),
                const SizedBox(height: 10),
                Expanded(
                  child: filtered.isEmpty
                      ? Center(
                          child: Text(
                            'No songs found.',
                            style: TextStyle(color: AppTheme.getTextSecondary(sheetCtx)),
                          ),
                        )
                      : ListView.separated(
                          itemCount: filtered.length,
                          separatorBuilder: (_, _) => const Divider(height: 1),
                          itemBuilder: (ctx, idx) {
                            final song = filtered[idx];
                            final filename = song['filename'] as String? ?? '';
                            final title = song['title'] as String? ?? filename;
                            final artist = song['artist'] as String? ?? '';
                            final alreadyAdded = existingTracks.contains(filename);

                            return ListTile(
                              dense: true,
                              contentPadding: EdgeInsets.zero,
                              leading: const Icon(Icons.music_note_rounded, color: AppTheme.primaryLight, size: 20),
                              title: Text(
                                title,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: AppTheme.getTextPrimary(sheetCtx),
                                  fontSize: 13,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              subtitle: artist.isNotEmpty
                                  ? Text(artist, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppTheme.getTextSecondary(sheetCtx), fontSize: 11))
                                  : null,
                              trailing: alreadyAdded
                                  ? const Text(
                                      'Added',
                                      style: TextStyle(color: Colors.green, fontSize: 12, fontWeight: FontWeight.bold),
                                    )
                                  : ElevatedButton(
                                      style: ElevatedButton.styleFrom(
                                        visualDensity: VisualDensity.compact,
                                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                                      ),
                                      onPressed: () async {
                                        final currentTracks = List<Map<String, dynamic>>.from(
                                          (playlist['tracks'] as List<dynamic>? ?? []).map((t) => Map<String, dynamic>.from(t as Map)),
                                        );
                                        currentTracks.add({
                                          'filename': filename,
                                          'title': title,
                                          'artist': artist,
                                        });

                                        try {
                                          await _api.updateMusicPlaylist(playlistId, tracks: currentTracks);
                                          playlist['tracks'] = currentTracks;
                                          existingTracks.add(filename);
                                          setSheetState(() {});
                                          setModalState(() {});
                                          _loadPlaylists(silent: true);
                                          if (_music.activePlaylistId.value == playlistId) {
                                            _music.updateQueue(currentTracks);
                                          }
                                        } catch (e) {
                                          if (mounted) {
                                            ScaffoldMessenger.of(context).showSnackBar(
                                              SnackBar(content: Text('Failed to add: $e'), backgroundColor: Colors.redAccent),
                                            );
                                          }
                                        }
                                      },
                                      child: const Text('Add', style: TextStyle(fontSize: 12)),
                                    ),
                            );
                          },
                        ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  void _showPlaylistTracks(Map<String, dynamic> playlist) {
    final playlistId = playlist['id'] as String? ?? '';
    final name = playlist['name'] as String? ?? 'Playlist';

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.getSurface(context),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (bottomSheetCtx) => StatefulBuilder(
        builder: (ctx, setModalState) {
          final tracks = List<Map<String, dynamic>>.from(
            (playlist['tracks'] as List<dynamic>? ?? []).map((t) => Map<String, dynamic>.from(t as Map)),
          );

          return Container(
            height: MediaQuery.of(context).size.height * 0.82,
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Top Header with Title and Track Count
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Expanded(
                      child: Text(
                        name,
                        style: TextStyle(
                          fontSize: 19,
                          fontWeight: FontWeight.bold,
                          color: AppTheme.getTextPrimary(ctx),
                        ),
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close_rounded, size: 20),
                      onPressed: () => Navigator.pop(ctx),
                    ),
                  ],
                ),

                const SizedBox(height: 8),

                // Controls: Play All, Shuffle, Add Songs
                Row(
                  children: [
                    ElevatedButton.icon(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppTheme.primary,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                      ),
                      icon: const Icon(Icons.play_arrow_rounded, size: 18),
                      label: const Text('Play All', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                      onPressed: tracks.isEmpty
                          ? null
                          : () {
                              _music.playPlaylist(playlist, startIndex: 0);
                              Navigator.pop(ctx);
                            },
                    ),
                    const SizedBox(width: 8),
                    OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      ),
                      icon: const Icon(Icons.shuffle_rounded, size: 16),
                      label: const Text('Shuffle', style: TextStyle(fontSize: 13)),
                      onPressed: tracks.isEmpty
                          ? null
                          : () {
                              final randIndex = Random().nextInt(tracks.length);
                              _music.playPlaylist(playlist, startIndex: randIndex);
                              Navigator.pop(ctx);
                            },
                    ),
                    const Spacer(),
                    FilledButton.tonalIcon(
                      style: FilledButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      ),
                      icon: const Icon(Icons.add_rounded, size: 16),
                      label: const Text('Add Songs', style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
                      onPressed: () => _showAddSongsToPlaylistPicker(playlist, setModalState),
                    ),
                  ],
                ),

                const SizedBox(height: 16),

                // Red Playback Priority Order Badge / Header
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: const Color(0xFFEF4444).withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: const Color(0xFFEF4444).withValues(alpha: 0.4)),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.swap_vert_rounded, color: Color(0xFFEF4444), size: 18),
                      const SizedBox(width: 8),
                      const Text(
                        'Playback Priority Order',
                        style: TextStyle(
                          color: Color(0xFFEF4444),
                          fontWeight: FontWeight.w800,
                          fontSize: 13,
                          letterSpacing: 0.2,
                        ),
                      ),
                      const Spacer(),
                      Text(
                        '${tracks.length} tracks • Drag to reorder',
                        style: const TextStyle(
                          color: Color(0xFFEF4444),
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 12),

                // Draggable Reorderable List
                if (tracks.isEmpty)
                  Expanded(
                    child: Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.playlist_add_rounded, size: 40, color: AppTheme.textSecondary),
                          const SizedBox(height: 10),
                          Text(
                            'No tracks in this playlist yet.',
                            style: TextStyle(color: AppTheme.getTextSecondary(ctx), fontSize: 13),
                          ),
                          const SizedBox(height: 12),
                          ElevatedButton.icon(
                            onPressed: () => _showAddSongsToPlaylistPicker(playlist, setModalState),
                            icon: const Icon(Icons.add_rounded, size: 16),
                            label: const Text('Add Songs Now'),
                          ),
                        ],
                      ),
                    ),
                  )
                else
                  Expanded(
                    child: ValueListenableBuilder<Map<String, dynamic>?>(
                      valueListenable: _music.currentTrack,
                      builder: (ctx, cur, _) {
                        return ValueListenableBuilder<PlayerState>(
                          valueListenable: _music.playerState,
                          builder: (ctx, state, _) {
                            final currentFilename = cur?['filename'] as String?;
                            final isPlaying = state == PlayerState.playing;

                            return ReorderableListView.builder(
                              itemCount: tracks.length,
                              // ignore: deprecated_member_use
                              onReorder: (oldIndex, newIndex) async {
                                if (oldIndex < newIndex) {
                                  newIndex -= 1;
                                }
                                final item = tracks.removeAt(oldIndex);
                                tracks.insert(newIndex, item);
                                playlist['tracks'] = tracks;
                                setModalState(() {});

                                if (_music.activePlaylistId.value == playlistId) {
                                  _music.updateQueue(tracks);
                                }

                                try {
                                  await _api.updateMusicPlaylist(playlistId, tracks: tracks);
                                  _loadPlaylists(silent: true);
                                } catch (e) {
                                  if (mounted) {
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      SnackBar(content: Text('Failed to save priority order: $e'), backgroundColor: Colors.redAccent),
                                    );
                                  }
                                }
                              },
                              itemBuilder: (ctx, index) {
                                final track = tracks[index];
                                final tTitle = track['title'] as String? ?? 'Track ${index + 1}';
                                final tArtist = track['artist'] as String? ?? '';
                                final tFilename = track['filename'] as String? ?? '';
                                final isThisPlaying = currentFilename == tFilename && isPlaying;

                                return ListTile(
                                  key: ValueKey('$tFilename-$index'),
                                  dense: true,
                                  contentPadding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                                  onTap: () {
                                    _music.playPlaylist(playlist, startIndex: index);
                                  },
                                  leading: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      // Priority Sequence Number
                                      Container(
                                        width: 24,
                                        alignment: Alignment.center,
                                        child: Text(
                                          '${index + 1}',
                                          style: const TextStyle(
                                            fontSize: 12,
                                            fontWeight: FontWeight.bold,
                                            color: Color(0xFFEF4444),
                                          ),
                                        ),
                                      ),
                                      const SizedBox(width: 6),
                                      Icon(
                                        isThisPlaying ? Icons.pause_circle_filled_rounded : Icons.play_circle_filled_rounded,
                                        color: isThisPlaying ? const Color(0xFF00E5FF) : AppTheme.primaryLight,
                                        size: 26,
                                      ),
                                    ],
                                  ),
                                  title: Text(
                                    tTitle,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                      color: isThisPlaying ? const Color(0xFF00E5FF) : AppTheme.getTextPrimary(ctx),
                                      fontSize: 13,
                                      fontWeight: isThisPlaying ? FontWeight.bold : FontWeight.w600,
                                    ),
                                  ),
                                  subtitle: tArtist.isNotEmpty
                                      ? Text(tArtist, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppTheme.getTextSecondary(ctx), fontSize: 11))
                                      : null,
                                  trailing: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      IconButton(
                                        icon: const Icon(Icons.remove_circle_outline_rounded, size: 18, color: Colors.redAccent),
                                        tooltip: 'Remove from playlist',
                                        onPressed: () async {
                                          tracks.removeAt(index);
                                          playlist['tracks'] = tracks;
                                          setModalState(() {});
                                          if (_music.activePlaylistId.value == playlistId) {
                                            _music.updateQueue(tracks);
                                          }
                                          try {
                                            await _api.updateMusicPlaylist(playlistId, tracks: tracks);
                                            _loadPlaylists(silent: true);
                                          } catch (_) {}
                                        },
                                      ),
                                      const Icon(Icons.drag_handle_rounded, color: AppTheme.textSecondary, size: 20),
                                    ],
                                  ),
                                );
                              },
                            );
                          },
                        );
                      },
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }

  String _formatDuration(Duration d) {
    final minutes = d.inMinutes.remainder(60).toString().padLeft(2, '0');
    final seconds = d.inSeconds.remainder(60).toString().padLeft(2, '0');
    return '$minutes:$seconds';
  }

  String _formatSize(dynamic size) {
    if (size == null) return '';
    final num bytes = size is num ? size : num.tryParse(size.toString()) ?? 0;
    if (bytes < 1024 * 1024) {
      return '${(bytes / 1024).toStringAsFixed(1)} KB';
    }
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.getBackground(context),
      body: Column(
        children: [
          // Voice Assistant Quick Suggestion Banner
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: InkWell(
              onTap: () => BipVoiceSheet.show(context),
              borderRadius: BorderRadius.circular(14),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: AppTheme.isDark
                        ? [const Color(0xFF261E38), const Color(0xFF191A26)]
                        : [const Color(0xFFEDE9FE), const Color(0xFFF1F5F9)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(
                    color: AppTheme.isDark
                        ? const Color(0xFF00E5FF).withValues(alpha: 0.3)
                        : const Color(0xFF7C3AED).withValues(alpha: 0.2),
                  ),
                ),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(6),
                      decoration: BoxDecoration(
                        color: AppTheme.isDark
                            ? const Color(0xFF00E5FF).withValues(alpha: 0.15)
                            : const Color(0xFF7C3AED).withValues(alpha: 0.15),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        Icons.mic_rounded,
                        color: AppTheme.isDark ? const Color(0xFF00E5FF) : AppTheme.primary,
                        size: 16,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Dictate Music to Bip',
                            style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.bold,
                              color: AppTheme.getTextPrimary(context),
                            ),
                          ),
                          Text(
                            'Say "Download songs by Queen" or "Play my workout playlist"',
                            style: TextStyle(fontSize: 11, color: AppTheme.getTextSecondary(context)),
                          ),
                        ],
                      ),
                    ),
                    Icon(Icons.arrow_forward_ios_rounded, size: 12, color: AppTheme.getTextSecondary(context)),
                  ],
                ),
              ),
            ),
          ),

          // Subtabs Navigation (Segmented control)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            child: SizedBox(
              width: double.infinity,
              child: SegmentedButton<int>(
                showSelectedIcon: false,
                style: const ButtonStyle(
                  visualDensity: VisualDensity.compact,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                segments: const [
                  ButtonSegment(
                    value: 0,
                    label: Text('Library'),
                  ),
                  ButtonSegment(
                    value: 1,
                    label: Text('Playlists'),
                  ),
                  ButtonSegment(
                    value: 2,
                    label: Text('Downloads'),
                  ),
                ],
                selected: {_currentSection},
                onSelectionChanged: (selected) {
                  setState(() => _currentSection = selected.first);
                },
              ),
            ),
          ),

          // Content Area
          Expanded(
            child: IndexedStack(
              index: _currentSection,
              children: [
                _buildLibrarySection(),
                _buildPlaylistsSection(),
                _buildDownloaderSection(),
              ],
            ),
          ),

          // Now Playing Mini Player Bar
          _buildMiniPlayer(),
        ],
      ),
    );
  }

  Widget _buildCoverThumbnail(
    String filename, {
    double size = 40,
    bool isCurrentSong = false,
    bool isPlaying = false,
  }) {
    final defaultBox = Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: isCurrentSong
            ? (AppTheme.isDark
                ? const Color(0xFF00E5FF).withValues(alpha: 0.2)
                : AppTheme.primary.withValues(alpha: 0.15))
            : (AppTheme.isDark
                ? AppTheme.primaryLight.withValues(alpha: 0.15)
                : Colors.grey.withValues(alpha: 0.15)),
        borderRadius: BorderRadius.circular(size > 60 ? 18 : 10),
        border: isCurrentSong
            ? Border.all(
                color: AppTheme.isDark
                    ? const Color(0xFF00E5FF).withValues(alpha: 0.6)
                    : AppTheme.primary)
            : null,
      ),
      child: Icon(
        isCurrentSong && isPlaying ? Icons.pause_rounded : Icons.music_note_rounded,
        color: isCurrentSong
            ? (AppTheme.isDark ? const Color(0xFF00E5FF) : AppTheme.primary)
            : (AppTheme.isDark ? AppTheme.primaryLight : AppTheme.primary),
        size: size * 0.45,
      ),
    );

    return FutureBuilder<File?>(
      future: _music.getOfflineCoverFile(filename),
      builder: (ctx, fileSnap) {
        if (fileSnap.hasData && fileSnap.data != null) {
          return ClipRRect(
            borderRadius: BorderRadius.circular(size > 60 ? 18 : 10),
            child: Stack(
              children: [
                Image.file(
                  fileSnap.data!,
                  width: size,
                  height: size,
                  fit: BoxFit.cover,
                  errorBuilder: (_, _, _) => defaultBox,
                ),
                if (isCurrentSong)
                  Container(
                    width: size,
                    height: size,
                    color: Colors.black38,
                    child: Icon(
                      isPlaying ? Icons.pause_rounded : Icons.play_arrow_rounded,
                      color: Colors.white,
                      size: size * 0.45,
                    ),
                  ),
              ],
            ),
          );
        }

        return FutureBuilder<String>(
          future: _api.resolveUrl('/api/music/cover/${Uri.encodeComponent(filename)}'),
          builder: (ctx, snap) {
            if (!snap.hasData || snap.data!.isEmpty) return defaultBox;

            return ClipRRect(
              borderRadius: BorderRadius.circular(size > 60 ? 18 : 10),
              child: Stack(
                children: [
                  Image.network(
                    snap.data!,
                    width: size,
                    height: size,
                    fit: BoxFit.cover,
                    errorBuilder: (_, _, _) => defaultBox,
                  ),
                  if (isCurrentSong)
                    Container(
                      width: size,
                      height: size,
                      color: Colors.black38,
                      child: Icon(
                        isPlaying ? Icons.pause_rounded : Icons.play_arrow_rounded,
                        color: Colors.white,
                        size: size * 0.45,
                      ),
                    ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  void _showSleepTimerDialog(BuildContext context) {
    final options = [
      {'label': 'Off', 'value': null},
      {'label': 'End of Track', 'value': 'track'},
      {'label': '15 Minutes', 'value': 15},
      {'label': '30 Minutes', 'value': 30},
      {'label': '45 Minutes', 'value': 45},
      {'label': '1 Hour', 'value': 60},
    ];

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.getSurface(ctx),
        title: Row(
          children: [
            const Icon(Icons.bedtime_outlined, color: Colors.amber),
            const SizedBox(width: 8),
            Text('Sleep Timer', style: TextStyle(color: AppTheme.getTextPrimary(ctx))),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: options.map((opt) {
            final val = opt['value'];
            final isCurrent = _music.sleepTimerDuration.value == val;
            return ListTile(
              title: Text(
                opt['label'] as String,
                style: TextStyle(
                  fontWeight: isCurrent ? FontWeight.bold : FontWeight.normal,
                  color: isCurrent ? const Color(0xFF8B5CF6) : AppTheme.getTextPrimary(ctx),
                ),
              ),
              trailing: isCurrent ? const Icon(Icons.check, color: Color(0xFF8B5CF6)) : null,
              onTap: () {
                _music.setSleepTimer(val);
                Navigator.pop(ctx);
              },
            );
          }).toList(),
        ),
      ),
    );
  }

  void _showCoverArtSheet(Map<String, dynamic> song) {
    final filename = song['filename'] as String? ?? '';
    final defaultTitle = song['title'] as String? ?? '';
    final defaultArtist = song['artist'] as String? ?? '';
    final initialQuery = defaultArtist.isNotEmpty ? '$defaultArtist $defaultTitle' : defaultTitle;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (sheetCtx) {
        String query = initialQuery;
        List<Map<String, dynamic>> candidates = [];
        bool searching = false;
        String? error;
        bool saving = false;

        return StatefulBuilder(
          builder: (ctx, setSheetState) {
            void runSearch([String? term]) async {
              final q = (term ?? query).trim();
              if (q.isEmpty) return;
              setSheetState(() {
                searching = true;
                error = null;
              });
              try {
                final results = await _api.searchMusicCovers(q);
                setSheetState(() {
                  candidates = results;
                  searching = false;
                  if (results.isEmpty) error = 'No album artwork found on iTunes.';
                });
              } catch (e) {
                setSheetState(() {
                  searching = false;
                  error = 'Failed to search iTunes.';
                });
              }
            }

            return Container(
              height: MediaQuery.of(context).size.height * 0.75,
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
              decoration: BoxDecoration(
                color: AppTheme.isDark ? const Color(0xFF14121F) : Colors.white,
                borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
              ),
              child: Column(
                children: [
                  Center(
                    child: Container(
                      width: 44,
                      height: 4,
                      decoration: BoxDecoration(
                        color: Colors.grey.withValues(alpha: 0.4),
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      const Icon(Icons.image_search_rounded, color: Color(0xFF8B5CF6)),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Choose Album Cover',
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.bold,
                                color: AppTheme.getTextPrimary(context),
                              ),
                            ),
                            Text(
                              'Powered by iTunes Catalog',
                              style: TextStyle(fontSize: 11, color: AppTheme.getTextSecondary(context)),
                            ),
                          ],
                        ),
                      ),
                      IconButton(
                        icon: Icon(Icons.close, color: AppTheme.getTextSecondary(context)),
                        onPressed: () => Navigator.pop(sheetCtx),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: TextEditingController(text: query)
                            ..selection = TextSelection.collapsed(offset: query.length),
                          onChanged: (v) => query = v,
                          onSubmitted: (v) => runSearch(v),
                          decoration: const InputDecoration(
                            hintText: 'Search artist or song…',
                            prefixIcon: Icon(Icons.search, size: 20),
                            contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      ElevatedButton(
                        onPressed: searching ? null : () => runSearch(),
                        child: searching
                            ? const SizedBox(
                                width: 14,
                                height: 14,
                                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                              )
                            : const Text('Search'),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  if (error != null)
                    Padding(
                      padding: const EdgeInsets.all(8.0),
                      child: Text(error!, style: const TextStyle(color: Colors.redAccent, fontSize: 13)),
                    ),
                  if (searching)
                    const Expanded(child: Center(child: CircularProgressIndicator()))
                  else
                    Expanded(
                      child: candidates.isEmpty
                          ? Center(
                              child: Text(
                                'Tap search to find album artwork on iTunes',
                                style: TextStyle(color: AppTheme.getTextSecondary(context)),
                              ),
                            )
                          : GridView.builder(
                              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                                crossAxisCount: 2,
                                childAspectRatio: 0.78,
                                crossAxisSpacing: 12,
                                mainAxisSpacing: 12,
                              ),
                              itemCount: candidates.length,
                              itemBuilder: (ctx, idx) {
                                final cand = candidates[idx];
                                final artUrl = cand['coverUrl'] as String? ??
                                    cand['thumbnailUrl'] as String? ??
                                    '';
                                final candTitle = cand['title'] as String? ?? '';
                                final candArtist = cand['artist'] as String? ?? '';

                                return Card(
                                  clipBehavior: Clip.antiAlias,
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                                  child: InkWell(
                                    onTap: saving
                                        ? null
                                        : () async {
                                            setSheetState(() => saving = true);
                                            final ok = await _api.saveMusicCover(filename, artUrl);
                                            if (!sheetCtx.mounted) return;
                                            Navigator.pop(sheetCtx);
                                            ScaffoldMessenger.of(sheetCtx).showSnackBar(
                                              SnackBar(
                                                content: Text(
                                                  ok
                                                      ? 'Cover art updated successfully!'
                                                      : 'Failed to save cover art',
                                                ),
                                              ),
                                            );
                                            _loadSongs(silent: true);
                                          },
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.stretch,
                                      children: [
                                        Expanded(
                                          child: Image.network(
                                            artUrl,
                                            fit: BoxFit.cover,
                                            errorBuilder: (_, _, _) =>
                                                const Icon(Icons.music_note, size: 40),
                                          ),
                                        ),
                                        Padding(
                                          padding: const EdgeInsets.all(8.0),
                                          child: Column(
                                            crossAxisAlignment: CrossAxisAlignment.start,
                                            children: [
                                              Text(
                                                candTitle,
                                                maxLines: 1,
                                                overflow: TextOverflow.ellipsis,
                                                style: const TextStyle(
                                                    fontWeight: FontWeight.bold, fontSize: 12),
                                              ),
                                              Text(
                                                candArtist,
                                                maxLines: 1,
                                                overflow: TextOverflow.ellipsis,
                                                style: TextStyle(
                                                    color: AppTheme.getTextSecondary(context),
                                                    fontSize: 11),
                                              ),
                                            ],
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                );
                              },
                            ),
                    ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  void _showNowPlayingSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: false,
      backgroundColor: Colors.transparent,
      barrierColor: Colors.black54,
      builder: (sheetContext) {
        return _NowPlayingSheet(
          onShowCoverArt: (track) => _showCoverArtSheet(track),
          onShowSleepTimer: () => _showSleepTimerDialog(context),
          buildCoverThumbnail: _buildCoverThumbnail,
        );
      },
    );
  }

  Widget _buildMiniPlayer() {
    return ValueListenableBuilder<Map<String, dynamic>?>(
      valueListenable: _music.currentTrack,
      builder: (context, track, _) {
        if (track == null) return const SizedBox.shrink();

        final filename = track['filename'] as String? ?? '';
        final title = track['title'] as String? ?? filename;
        final artist = track['artist'] as String? ?? '';

        return ValueListenableBuilder<PlayerState>(
          valueListenable: _music.playerState,
          builder: (context, state, _) {
            final isPlaying = state == PlayerState.playing;

            return ValueListenableBuilder<Duration>(
              valueListenable: _music.position,
              builder: (context, pos, _) {
                return ValueListenableBuilder<Duration>(
                  valueListenable: _music.duration,
                  builder: (context, dur, _) {
                    final posStr = _formatDuration(pos);
                    final durStr = _formatDuration(dur);

                    return SafeArea(
                      top: false,
                      child: Container(
                        padding: const EdgeInsets.fromLTRB(14, 6, 14, 10),
                        decoration: BoxDecoration(
                          color: AppTheme.isDark ? const Color(0xFF161522) : const Color(0xFFFFFFFF),
                          border: Border(
                            top: BorderSide(
                              color: AppTheme.isDark ? const Color(0xFF2C2840) : const Color(0xFFE2E8F0),
                              width: 1.5,
                            ),
                          ),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withValues(alpha: AppTheme.isDark ? 0.5 : 0.08),
                              blurRadius: 18,
                              offset: const Offset(0, -4),
                            ),
                          ],
                        ),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            // Progress Slider with Shuffle & Repeat
                            Row(
                              children: [
                                ValueListenableBuilder<bool>(
                                  valueListenable: _music.isShuffle,
                                  builder: (ctx, isShuf, _) => IconButton(
                                    icon: Icon(
                                      Icons.shuffle_rounded,
                                      size: 19,
                                      color: isShuf
                                          ? (AppTheme.isDark ? const Color(0xFF00E5FF) : AppTheme.primary)
                                          : AppTheme.getTextSecondary(context),
                                    ),
                                    visualDensity: VisualDensity.compact,
                                    padding: EdgeInsets.zero,
                                    constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                                    tooltip: isShuf ? 'Shuffle On' : 'Shuffle Off',
                                    onPressed: _music.toggleShuffle,
                                  ),
                                ),
                                const SizedBox(width: 4),
                                Text(
                                  posStr,
                                  style: TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w600,
                                    color: AppTheme.getTextSecondary(context),
                                  ),
                                ),
                                Expanded(
                                  child: SliderTheme(
                                    data: SliderTheme.of(context).copyWith(
                                      thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 5),
                                      overlayShape: const RoundSliderOverlayShape(overlayRadius: 10),
                                      trackHeight: 3.5,
                                      activeTrackColor: AppTheme.isDark ? const Color(0xFF00E5FF) : AppTheme.primary,
                                      inactiveTrackColor: AppTheme.isDark ? Colors.white12 : Colors.black12,
                                      thumbColor: AppTheme.isDark ? const Color(0xFF00E5FF) : AppTheme.primary,
                                    ),
                                    child: Slider(
                                      value: dur.inMilliseconds > 0
                                          ? (pos.inMilliseconds / dur.inMilliseconds).clamp(0.0, 1.0)
                                          : 0.0,
                                      onChanged: (val) {
                                        final targetMs = (val * dur.inMilliseconds).toInt();
                                        _music.seek(Duration(milliseconds: targetMs));
                                      },
                                    ),
                                  ),
                                ),
                                Text(
                                  durStr,
                                  style: TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w600,
                                    color: AppTheme.getTextSecondary(context),
                                  ),
                                ),
                                const SizedBox(width: 4),
                                ValueListenableBuilder<String>(
                                  valueListenable: _music.repeatMode,
                                  builder: (ctx, mode, _) => IconButton(
                                    icon: Icon(
                                      mode == 'one' ? Icons.repeat_one_rounded : Icons.repeat_rounded,
                                      size: 19,
                                      color: mode != 'off'
                                          ? (AppTheme.isDark ? const Color(0xFF00E5FF) : AppTheme.primary)
                                          : AppTheme.getTextSecondary(context),
                                    ),
                                    visualDensity: VisualDensity.compact,
                                    padding: EdgeInsets.zero,
                                    constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                                    tooltip: mode == 'one' ? 'Repeat One' : (mode == 'all' ? 'Repeat All' : 'Repeat Off'),
                                    onPressed: _music.toggleRepeatMode,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 2),

                            // Main Controls Row
                            Row(
                              children: [
                                // Cover Art Thumbnail (Clickable to open Now Playing)
                                GestureDetector(
                                  onTap: () => _showNowPlayingSheet(context),
                                  child: Container(
                                    decoration: BoxDecoration(
                                      borderRadius: BorderRadius.circular(10),
                                      boxShadow: [
                                        BoxShadow(
                                          color: (AppTheme.isDark ? const Color(0xFF00E5FF) : AppTheme.primary)
                                              .withValues(alpha: 0.25),
                                          blurRadius: 8,
                                          offset: const Offset(0, 2),
                                        ),
                                      ],
                                    ),
                                    child: ClipRRect(
                                      borderRadius: BorderRadius.circular(10),
                                      child: _buildCoverThumbnail(
                                        filename,
                                        size: 52,
                                        isCurrentSong: true,
                                        isPlaying: isPlaying,
                                      ),
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 12),

                                // Track Title & Artist (Tap to expand)
                                Expanded(
                                  child: GestureDetector(
                                    behavior: HitTestBehavior.opaque,
                                    onTap: () => _showNowPlayingSheet(context),
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        Text(
                                          title,
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: TextStyle(
                                            fontSize: 15,
                                            fontWeight: FontWeight.bold,
                                            color: AppTheme.getTextPrimary(context),
                                          ),
                                        ),
                                        const SizedBox(height: 2),
                                        ValueListenableBuilder<String?>(
                                          valueListenable: _music.activePlaylistName,
                                          builder: (context, plName, _) {
                                            final sub = artist.isNotEmpty
                                                ? (plName != null ? '$artist • $plName' : artist)
                                                : (plName ?? 'Muse Music');
                                            return Text(
                                              sub,
                                              maxLines: 1,
                                              overflow: TextOverflow.ellipsis,
                                              style: TextStyle(
                                                fontSize: 12.5,
                                                fontWeight: FontWeight.w500,
                                                color: AppTheme.getTextSecondary(context),
                                              ),
                                            );
                                          },
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 6),

                                // Previous Track
                                IconButton(
                                  icon: const Icon(Icons.skip_previous_rounded, size: 28),
                                  color: AppTheme.getTextPrimary(context),
                                  tooltip: 'Previous',
                                  padding: EdgeInsets.zero,
                                  constraints: const BoxConstraints(minWidth: 40, minHeight: 40),
                                  onPressed: _music.previous,
                                ),

                                const SizedBox(width: 4),

                                // Prominent Big Play / Pause Button
                                ValueListenableBuilder<bool>(
                                  valueListenable: _music.loading,
                                  builder: (context, isLoading, _) {
                                    if (isLoading) {
                                      return Container(
                                        width: 44,
                                        height: 44,
                                        decoration: BoxDecoration(
                                          shape: BoxShape.circle,
                                          color: (AppTheme.isDark ? const Color(0xFF00E5FF) : AppTheme.primary)
                                              .withValues(alpha: 0.15),
                                        ),
                                        child: Center(
                                          child: SizedBox(
                                            width: 20,
                                            height: 20,
                                            child: CircularProgressIndicator(
                                              strokeWidth: 2.5,
                                              color: AppTheme.isDark ? const Color(0xFF00E5FF) : AppTheme.primary,
                                            ),
                                          ),
                                        ),
                                      );
                                    }
                                    return Container(
                                      width: 44,
                                      height: 44,
                                      decoration: BoxDecoration(
                                        shape: BoxShape.circle,
                                        gradient: LinearGradient(
                                          colors: AppTheme.isDark
                                              ? const [Color(0xFF00E5FF), Color(0xFF7C3AED)]
                                              : const [AppTheme.primary, AppTheme.primaryLight],
                                          begin: Alignment.topLeft,
                                          end: Alignment.bottomRight,
                                        ),
                                        boxShadow: [
                                          BoxShadow(
                                            color: (AppTheme.isDark ? const Color(0xFF00E5FF) : AppTheme.primary)
                                                .withValues(alpha: 0.35),
                                            blurRadius: 10,
                                            offset: const Offset(0, 3),
                                          ),
                                        ],
                                      ),
                                      child: IconButton(
                                        icon: Icon(
                                          isPlaying ? Icons.pause_rounded : Icons.play_arrow_rounded,
                                          color: Colors.white,
                                          size: 28,
                                        ),
                                        padding: EdgeInsets.zero,
                                        tooltip: isPlaying ? 'Pause' : 'Play',
                                        onPressed: _music.togglePlayPause,
                                      ),
                                    );
                                  },
                                ),

                                const SizedBox(width: 4),

                                // Next Track
                                IconButton(
                                  icon: const Icon(Icons.skip_next_rounded, size: 28),
                                  color: AppTheme.getTextPrimary(context),
                                  tooltip: 'Next',
                                  padding: EdgeInsets.zero,
                                  constraints: const BoxConstraints(minWidth: 40, minHeight: 40),
                                  onPressed: _music.next,
                                ),

                                const SizedBox(width: 4),

                                // Expand Now Playing
                                IconButton(
                                  icon: Icon(Icons.open_in_full_rounded, size: 20, color: AppTheme.getTextSecondary(context)),
                                  tooltip: 'Expand',
                                  padding: EdgeInsets.zero,
                                  constraints: const BoxConstraints(minWidth: 34, minHeight: 34),
                                  onPressed: () => _showNowPlayingSheet(context),
                                ),

                                // Stop / Close
                                IconButton(
                                  icon: Icon(Icons.close_rounded, size: 20, color: AppTheme.getTextSecondary(context)),
                                  tooltip: 'Close',
                                  padding: EdgeInsets.zero,
                                  constraints: const BoxConstraints(minWidth: 34, minHeight: 34),
                                  onPressed: _music.stop,
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                );
              },
            );
          },
        );
      },
    );
  }

  Widget _buildLibrarySection() {
    final query = _songSearch.toLowerCase();
    final filtered = _songs.where((s) {
      final title = (s['title'] as String? ?? s['filename'] as String? ?? '').toLowerCase();
      final artist = (s['artist'] as String? ?? '').toLowerCase();
      return title.contains(query) || artist.contains(query);
    }).toList();

    return RefreshIndicator(
      onRefresh: () => _loadSongs(silent: false),
      child: Column(
        children: [
          // Red Library Songs Header / Badge matching Web Client
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
            child: Wrap(
              alignment: WrapAlignment.spaceBetween,
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 8,
              runSpacing: 6,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    color: const Color(0xFFEF4444).withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: const Color(0xFFEF4444).withValues(alpha: 0.4)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.library_music_rounded, color: Color(0xFFEF4444), size: 16),
                      const SizedBox(width: 6),
                      const Text(
                        'Library Songs',
                        style: TextStyle(
                          color: Color(0xFFEF4444),
                          fontWeight: FontWeight.w800,
                          fontSize: 13,
                          letterSpacing: 0.2,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                        decoration: BoxDecoration(
                          color: const Color(0xFFEF4444),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Text(
                          '${_songs.length}',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 11,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    ValueListenableBuilder<({int current, int total, bool active})>(
                      valueListenable: _music.batchDownloadStatus,
                      builder: (ctx, batch, _) {
                        if (batch.active) {
                          return Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            margin: const EdgeInsets.only(right: 6),
                            decoration: BoxDecoration(
                              color: AppTheme.accent.withValues(alpha: 0.15),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const SizedBox(
                                  width: 12,
                                  height: 12,
                                  child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.accent),
                                ),
                                const SizedBox(width: 6),
                                Text(
                                  '${batch.current}/${batch.total}',
                                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppTheme.accent),
                                ),
                              ],
                            ),
                          );
                        }

                        final hasOnlineTracks = _songs.any((s) {
                          final f = s['filename'] as String? ?? '';
                          return f.isNotEmpty && !_music.isTrackOffline(f);
                        });

                        if (!hasOnlineTracks || _songs.isEmpty) {
                          return const SizedBox.shrink();
                        }

                        return TextButton.icon(
                          style: TextButton.styleFrom(
                            visualDensity: VisualDensity.compact,
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                          ),
                          onPressed: () async {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('Downloading songs to your phone for offline playback…')),
                            );
                            await _music.downloadAllOffline(_songs);
                          },
                          icon: const Icon(Icons.download_for_offline_outlined, size: 16),
                          label: const Text('Download All', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                        );
                      },
                    ),
                    TextButton.icon(
                      style: TextButton.styleFrom(
                        visualDensity: VisualDensity.compact,
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      ),
                      onPressed: () => setState(() => _currentSection = 2),
                      icon: const Icon(Icons.add_circle_outline_rounded, size: 16),
                      label: const Text('Add / Download', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                    ),
                  ],
                ),
              ],
            ),
          ),

          // Search bar
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
            child: TextField(
              controller: _searchController,
              onChanged: (val) => setState(() => _songSearch = val.trim()),
              decoration: InputDecoration(
                hintText: 'Search songs or artists…',
                prefixIcon: const Icon(Icons.search, size: 20),
                suffixIcon: _songSearch.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear, size: 18),
                        onPressed: () {
                          _searchController.clear();
                          setState(() => _songSearch = '');
                        },
                      )
                    : null,
                contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              ),
            ),
          ),

          if (_loadingSongs)
            const Expanded(child: Center(child: CircularProgressIndicator()))
          else if (_songs.isEmpty)
            Expanded(
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.music_off_rounded, size: 48, color: AppTheme.textSecondary),
                    const SizedBox(height: 12),
                    Text(
                      'No songs in your library yet',
                      style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.getTextPrimary(context)),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Use Downloader or dictate to Bip to add songs',
                      style: TextStyle(fontSize: 13, color: AppTheme.getTextSecondary(context)),
                    ),
                    const SizedBox(height: 14),
                    ElevatedButton.icon(
                      onPressed: () => setState(() => _currentSection = 2),
                      icon: const Icon(Icons.download_rounded, size: 16),
                      label: const Text('Go to Downloader'),
                    ),
                  ],
                ),
              ),
            )
          else if (filtered.isEmpty)
            Expanded(
              child: Center(
                child: Text('No matching songs found', style: TextStyle(color: AppTheme.getTextSecondary(context))),
              ),
            )
          else
            Expanded(
              child: ValueListenableBuilder<Map<String, dynamic>?>(
                valueListenable: _music.currentTrack,
                builder: (context, curTrack, _) {
                  return ValueListenableBuilder<PlayerState>(
                    valueListenable: _music.playerState,
                    builder: (context, playState, _) {
                      final currentFilename = curTrack?['filename'] as String?;
                      final isPlaying = playState == PlayerState.playing;

                      return ListView.separated(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                        itemCount: filtered.length,
                        separatorBuilder: (_, _) => const Divider(height: 1),
                        itemBuilder: (ctx, index) {
                          final song = filtered[index];
                          final filename = song['filename'] as String? ?? '';
                          final title = song['title'] as String? ?? filename;
                          final artist = song['artist'] as String? ?? '';
                          final sizeFormatted = _formatSize(song['size']);
                          final isCurrentSong = currentFilename == filename;

                          return ListTile(
                            contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            onTap: () {
                              if (isCurrentSong) {
                                _music.togglePlayPause();
                              } else {
                                _music.playSong(song, contextQueue: filtered);
                              }
                            },
                            leading: _buildCoverThumbnail(
                              filename,
                              size: 44,
                              isCurrentSong: isCurrentSong,
                              isPlaying: isPlaying,
                            ),
                            title: Text(
                              title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontWeight: FontWeight.w600,
                                fontSize: 14,
                                color: isCurrentSong
                                    ? (AppTheme.isDark ? const Color(0xFF00E5FF) : AppTheme.primary)
                                    : AppTheme.getTextPrimary(context),
                              ),
                            ),
                            subtitle: Row(
                              children: [
                                if (artist.isNotEmpty) ...[
                                  Expanded(
                                    child: Text(
                                      artist,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(fontSize: 12, color: AppTheme.getTextSecondary(context)),
                                    ),
                                  ),
                                  const SizedBox(width: 6),
                                ],
                                if (sizeFormatted.isNotEmpty)
                                  Text(
                                    sizeFormatted,
                                    style: TextStyle(fontSize: 11, color: AppTheme.getTextSecondary(context)),
                                  ),
                                ValueListenableBuilder<Set<String>>(
                                  valueListenable: _music.offlineTrackFilenames,
                                  builder: (ctx, offlineSet, _) {
                                    final isOffline = offlineSet.contains(filename);
                                    if (!isOffline) return const SizedBox.shrink();
                                    return Container(
                                      margin: const EdgeInsets.only(left: 6),
                                      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1.5),
                                      decoration: BoxDecoration(
                                        color: Colors.green.withValues(alpha: 0.15),
                                        borderRadius: BorderRadius.circular(4),
                                        border: Border.all(color: Colors.green.withValues(alpha: 0.4), width: 0.8),
                                      ),
                                      child: const Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          Icon(Icons.download_done_rounded, size: 10, color: Colors.green),
                                          SizedBox(width: 2),
                                          Text('Offline', style: TextStyle(fontSize: 9, fontWeight: FontWeight.bold, color: Colors.green)),
                                        ],
                                      ),
                                    );
                                  },
                                ),
                              ],
                            ),
                            trailing: PopupMenuButton<String>(
                              icon: Icon(Icons.more_vert, size: 20, color: AppTheme.getTextSecondary(context)),
                              onSelected: (val) async {
                                if (val == 'play') {
                                  _music.playSong(song, contextQueue: filtered);
                                } else if (val == 'add_playlist') {
                                  _addSongToPlaylistModal(song);
                                } else if (val == 'offline') {
                                  if (_music.isTrackOffline(filename)) {
                                    await _music.deleteOfflineTrack(filename);
                                    if (!ctx.mounted) return;
                                    ScaffoldMessenger.of(ctx).showSnackBar(
                                      const SnackBar(content: Text('Removed offline audio cache')),
                                    );
                                  } else {
                                    final ok = await _music.downloadTrackOffline(song);
                                    if (!ctx.mounted) return;
                                    ScaffoldMessenger.of(ctx).showSnackBar(
                                      SnackBar(
                                        content: Text(ok ? 'Saved for offline listening!' : 'Offline download failed'),
                                      ),
                                    );
                                  }
                                } else if (val == 'cover') {
                                  _showCoverArtSheet(song);
                                } else if (val == 'delete') {
                                  _deleteSong(filename, title);
                                }
                              },
                              itemBuilder: (ctx) => [
                                PopupMenuItem(
                                  value: 'play',
                                  child: Row(
                                    children: [
                                      Icon(
                                        isCurrentSong && isPlaying ? Icons.pause_rounded : Icons.play_arrow_rounded,
                                        color: AppTheme.primaryLight,
                                        size: 18,
                                      ),
                                      const SizedBox(width: 8),
                                      Text(isCurrentSong && isPlaying ? 'Pause' : 'Play Song'),
                                    ],
                                  ),
                                ),
                                const PopupMenuItem(
                                  value: 'add_playlist',
                                  child: Row(
                                    children: [
                                      Icon(Icons.playlist_add_rounded, color: AppTheme.primaryLight, size: 18),
                                      SizedBox(width: 8),
                                      Text('Add to Playlist'),
                                    ],
                                  ),
                                ),
                                PopupMenuItem(
                                  value: 'offline',
                                  child: Row(
                                    children: [
                                      Icon(
                                        _music.isTrackOffline(filename)
                                            ? Icons.delete_sweep_outlined
                                            : Icons.download_rounded,
                                        color: AppTheme.primaryLight,
                                        size: 18,
                                      ),
                                      const SizedBox(width: 8),
                                      Text(_music.isTrackOffline(filename)
                                          ? 'Remove Offline Cache'
                                          : 'Save for Offline Listening'),
                                    ],
                                  ),
                                ),
                                const PopupMenuItem(
                                  value: 'cover',
                                  child: Row(
                                    children: [
                                      Icon(Icons.image_search_rounded, color: Color(0xFF8B5CF6), size: 18),
                                      SizedBox(width: 8),
                                      Text('Search Album Cover'),
                                    ],
                                  ),
                                ),
                                const PopupMenuItem(
                                  value: 'delete',
                                  child: Row(
                                    children: [
                                      Icon(Icons.delete_outline, color: Colors.redAccent, size: 18),
                                      SizedBox(width: 8),
                                      Text('Delete Song', style: TextStyle(color: Colors.redAccent)),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          );
                        },
                      );
                    },
                  );
                },
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildPlaylistsSection() {
    return RefreshIndicator(
      onRefresh: () => _loadPlaylists(silent: false),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: Wrap(
              alignment: WrapAlignment.spaceBetween,
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 8,
              runSpacing: 6,
              children: [
                Text(
                  '${_playlists.length} Playlist${_playlists.length == 1 ? '' : 's'}',
                  style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: AppTheme.getTextSecondary(context)),
                ),
                ElevatedButton.icon(
                  onPressed: _createNewPlaylist,
                  icon: const Icon(Icons.add, size: 16),
                  label: const Text('New Playlist'),
                ),
              ],
            ),
          ),
          if (_loadingPlaylists)
            const Expanded(child: Center(child: CircularProgressIndicator()))
          else if (_playlists.isEmpty)
            Expanded(
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.playlist_add_rounded, size: 48, color: AppTheme.textSecondary),
                    const SizedBox(height: 12),
                    Text(
                      'No playlists created yet',
                      style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.getTextPrimary(context)),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Group your favorite tracks into custom collections',
                      style: TextStyle(fontSize: 13, color: AppTheme.getTextSecondary(context)),
                    ),
                    const SizedBox(height: 14),
                    OutlinedButton.icon(
                      onPressed: _createNewPlaylist,
                      icon: const Icon(Icons.add, size: 16),
                      label: const Text('Create First Playlist'),
                    ),
                  ],
                ),
              ),
            )
          else
            Expanded(
              child: ValueListenableBuilder<String?>(
                valueListenable: _music.activePlaylistId,
                builder: (context, activePlId, _) {
                  return ListView.separated(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    itemCount: _playlists.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 8),
                    itemBuilder: (ctx, index) {
                      final pl = _playlists[index];
                      final id = pl['id'] as String? ?? '';
                      final name = pl['name'] as String? ?? 'Untitled';
                      final tracks = pl['tracks'] as List<dynamic>? ?? [];
                      final isCurrentPlaylist = activePlId == id;

                      return Card(
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                          side: BorderSide(
                            color: isCurrentPlaylist
                                ? (AppTheme.isDark ? const Color(0xFF00E5FF) : AppTheme.primary)
                                : AppTheme.getSurfaceBorder(context),
                            width: isCurrentPlaylist ? 1.5 : 1.0,
                          ),
                        ),
                        child: ListTile(
                          onTap: () => _showPlaylistTracks(pl),
                          leading: InkWell(
                            onTap: tracks.isEmpty
                                ? null
                                : () => _music.playPlaylist(pl, startIndex: 0),
                            borderRadius: BorderRadius.circular(10),
                            child: Container(
                              padding: const EdgeInsets.all(10),
                              decoration: BoxDecoration(
                                color: isCurrentPlaylist
                                    ? const Color(0xFFEF4444).withValues(alpha: 0.2)
                                    : const Color(0xFFFF4081).withValues(alpha: 0.15),
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Icon(
                                isCurrentPlaylist ? Icons.music_note_rounded : Icons.playlist_play_rounded,
                                color: isCurrentPlaylist ? const Color(0xFFEF4444) : const Color(0xFFFF4081),
                                size: 24,
                              ),
                            ),
                          ),
                          title: Text(
                            name,
                            style: TextStyle(
                              fontWeight: FontWeight.bold,
                              color: isCurrentPlaylist
                                  ? (AppTheme.isDark ? const Color(0xFF00E5FF) : AppTheme.primary)
                                  : AppTheme.getTextPrimary(context),
                            ),
                          ),
                          subtitle: Text(
                            '${tracks.length} track${tracks.length == 1 ? '' : 's'}',
                            style: TextStyle(fontSize: 12, color: AppTheme.getTextSecondary(context)),
                          ),
                          trailing: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              if (tracks.isNotEmpty)
                                IconButton(
                                  icon: Icon(
                                    Icons.play_circle_fill_rounded,
                                    color: isCurrentPlaylist ? const Color(0xFF00E5FF) : AppTheme.primaryLight,
                                    size: 28,
                                  ),
                                  tooltip: 'Play Playlist',
                                  onPressed: () => _music.playPlaylist(pl, startIndex: 0),
                                ),
                              IconButton(
                                icon: const Icon(Icons.delete_outline, size: 20, color: Colors.redAccent),
                                tooltip: 'Delete Playlist',
                                onPressed: () => _deletePlaylist(id, name),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  );
                },
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildDownloaderSection() {
    return RefreshIndicator(
      onRefresh: () => _loadTasks(silent: false),
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Download Card
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(
                    children: [
                      Icon(Icons.cloud_download_rounded, color: AppTheme.primaryLight, size: 20),
                      SizedBox(width: 8),
                      Text(
                        'FastAPI Downloader (yt-dlp)',
                        style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'Paste a YouTube URL, SoundCloud link, or song name with artist to download directly to your library.',
                    style: TextStyle(fontSize: 12, color: AppTheme.getTextSecondary(context), height: 1.3),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _downloadUrlController,
                    decoration: const InputDecoration(
                      hintText: 'https://youtube.com/watch?v=... or artist - song',
                      prefixIcon: Icon(Icons.link_rounded, size: 20),
                    ),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      onPressed: _submittingDownload ? null : _submitDownload,
                      icon: _submittingDownload
                          ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                          : const Icon(Icons.download_rounded, size: 18),
                      label: Text(_submittingDownload ? 'Scheduling…' : 'Start Download'),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          // Download Queue Header
          Wrap(
            alignment: WrapAlignment.spaceBetween,
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 8,
            children: [
              Text(
                'Download Queue & History',
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: AppTheme.getTextSecondary(context)),
              ),
              IconButton(
                icon: const Icon(Icons.refresh, size: 18),
                onPressed: () => _loadTasks(silent: false),
              ),
            ],
          ),
          const SizedBox(height: 8),

          if (_loadingTasks)
            const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator()))
          else if (_tasks.isEmpty)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Center(
                  child: Column(
                    children: [
                      const Icon(Icons.check_circle_outline_rounded, size: 36, color: AppTheme.textSecondary),
                      const SizedBox(height: 8),
                      Text('No pending downloads', style: TextStyle(color: AppTheme.getTextSecondary(context), fontSize: 13)),
                    ],
                  ),
                ),
              ),
            )
          else
            ..._tasks.map((task) {
              final title = task['title'] as String? ?? task['query'] as String? ?? 'Track';
              final status = task['status'] as String? ?? 'pending';
              final progress = task['progress'] as num? ?? 0;
              final error = task['error'] as String?;

              Color statusColor;
              IconData statusIcon;
              if (status == 'completed') {
                statusColor = Colors.green;
                statusIcon = Icons.check_circle_rounded;
              } else if (status == 'failed') {
                statusColor = Colors.redAccent;
                statusIcon = Icons.error_rounded;
              } else if (status == 'downloading') {
                statusColor = const Color(0xFF00E5FF);
                statusIcon = Icons.downloading_rounded;
              } else {
                statusColor = Colors.amber;
                statusIcon = Icons.schedule_rounded;
              }

              return Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Icon(statusIcon, color: statusColor, size: 18),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                            decoration: BoxDecoration(
                              color: statusColor.withValues(alpha: 0.15),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Text(
                              status.toUpperCase(),
                              style: TextStyle(color: statusColor, fontSize: 10, fontWeight: FontWeight.bold),
                            ),
                          ),
                        ],
                      ),
                      if (status == 'downloading') ...[
                        const SizedBox(height: 8),
                        LinearProgressIndicator(
                          value: progress > 0 ? (progress / 100).toDouble() : null,
                          backgroundColor: Colors.white10,
                          color: const Color(0xFF00E5FF),
                        ),
                      ],
                      if (error != null && error.isNotEmpty) ...[
                        const SizedBox(height: 6),
                        Text(error, style: const TextStyle(color: Colors.redAccent, fontSize: 11)),
                      ],
                    ],
                  ),
                ),
              );
            }),
        ],
      ),
    );
  }
}

class _SoundWaveVisualizer extends StatefulWidget {
  final bool isPlaying;
  const _SoundWaveVisualizer({required this.isPlaying});

  @override
  State<_SoundWaveVisualizer> createState() => _SoundWaveVisualizerState();
}

class _SoundWaveVisualizerState extends State<_SoundWaveVisualizer>
    with SingleTickerProviderStateMixin {
  late AnimationController _ctrl;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 700))
      ..repeat(reverse: true);
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.isPlaying) {
      return Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: List.generate(
          16,
          (i) => Container(
            margin: const EdgeInsets.symmetric(horizontal: 2),
            width: 3.5,
            height: 4,
            decoration: BoxDecoration(
              color: Colors.purple.withValues(alpha: 0.3),
              borderRadius: BorderRadius.circular(2),
            ),
          ),
        ),
      );
    }

    return AnimatedBuilder(
      animation: _ctrl,
      builder: (context, _) {
        final val = _ctrl.value;
        return Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: List.generate(16, (i) {
            final offset = sin((i / 16) * pi * 2 + (val * pi * 2));
            final height = 4.0 + (offset.abs() * 18.0);
            return Container(
              margin: const EdgeInsets.symmetric(horizontal: 2),
              width: 3.5,
              height: height,
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  begin: Alignment.bottomCenter,
                  end: Alignment.topCenter,
                  colors: [Color(0xFF7C3AED), Color(0xFFEC4899)],
                ),
                borderRadius: BorderRadius.circular(2),
              ),
            );
          }),
        );
      },
    );
  }
}

class _NowPlayingSheet extends StatefulWidget {
  final void Function(Map<String, dynamic> track) onShowCoverArt;
  final VoidCallback onShowSleepTimer;
  final Widget Function(String filename, {double size, bool isCurrentSong, bool isPlaying}) buildCoverThumbnail;

  const _NowPlayingSheet({
    required this.onShowCoverArt,
    required this.onShowSleepTimer,
    required this.buildCoverThumbnail,
  });

  @override
  State<_NowPlayingSheet> createState() => _NowPlayingSheetState();
}

class _NowPlayingSheetState extends State<_NowPlayingSheet> {
  final DraggableScrollableController _dragController = DraggableScrollableController();
  final MusicService _music = MusicService();
  double _currentExtent = 0.88;

  @override
  void initState() {
    super.initState();
    _dragController.addListener(_onExtentChanged);
  }

  void _onExtentChanged() {
    if (_dragController.isAttached) {
      final ext = _dragController.size;
      if ((ext - _currentExtent).abs() > 0.01) {
        setState(() => _currentExtent = ext);
      }
    }
  }

  @override
  void dispose() {
    _dragController.removeListener(_onExtentChanged);
    _dragController.dispose();
    super.dispose();
  }

  void _toggleFullScreen() {
    if (!_dragController.isAttached) return;
    final target = _currentExtent >= 0.95 ? 0.88 : 1.0;
    _dragController.animateTo(
      target,
      duration: const Duration(milliseconds: 320),
      curve: Curves.easeOutCubic,
    );
  }

  String _formatDuration(Duration d) {
    final m = d.inMinutes;
    final s = d.inSeconds % 60;
    return '$m:${s.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final isFullScreen = _currentExtent >= 0.95;

    return NotificationListener<DraggableScrollableNotification>(
      onNotification: (notification) {
        if (notification.extent <= 0.44) {
          Navigator.of(context).pop();
          return true;
        }
        return false;
      },
      child: DraggableScrollableSheet(
        controller: _dragController,
        initialChildSize: 0.88,
        minChildSize: 0.40,
        maxChildSize: 1.0,
        snap: true,
        snapSizes: const [0.88, 1.0],
        builder: (sheetInnerContext, scrollController) {
          return ValueListenableBuilder<Map<String, dynamic>?>(
            valueListenable: _music.currentTrack,
            builder: (context, track, _) {
              if (track == null) return const SizedBox.shrink();
              final filename = track['filename'] as String? ?? '';
              final title = track['title'] as String? ?? filename;
              final artist = track['artist'] as String? ?? '';

              return ValueListenableBuilder<PlayerState>(
                valueListenable: _music.playerState,
                builder: (context, state, _) {
                  final isPlaying = state == PlayerState.playing;

                  return ValueListenableBuilder<Duration>(
                    valueListenable: _music.position,
                    builder: (context, pos, _) {
                      return ValueListenableBuilder<Duration>(
                        valueListenable: _music.duration,
                        builder: (context, dur, _) {
                          final artworkSize = isFullScreen ? 280.0 : 230.0;
                          final topRadius = isFullScreen ? 0.0 : 28.0;

                          return Container(
                            decoration: BoxDecoration(
                              color: AppTheme.isDark ? const Color(0xFF13101E) : Colors.white,
                              borderRadius: BorderRadius.vertical(top: Radius.circular(topRadius)),
                              boxShadow: const [
                                BoxShadow(color: Colors.black54, blurRadius: 28, offset: Offset(0, -8)),
                              ],
                            ),
                            child: SafeArea(
                              top: isFullScreen,
                              bottom: true,
                              child: SingleChildScrollView(
                                controller: scrollController,
                                physics: const ClampingScrollPhysics(),
                                padding: EdgeInsets.fromLTRB(
                                  24,
                                  isFullScreen ? 8 : 12,
                                  24,
                                  16,
                                ),
                                child: Column(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    // Drag Handle (Tap to toggle full screen, or drag up / down)
                                    GestureDetector(
                                      behavior: HitTestBehavior.opaque,
                                      onTap: _toggleFullScreen,
                                      child: Container(
                                        padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 20),
                                        child: Container(
                                          width: 48,
                                          height: 5,
                                          decoration: BoxDecoration(
                                            color: Colors.grey.withValues(alpha: 0.45),
                                            borderRadius: BorderRadius.circular(3),
                                          ),
                                        ),
                                      ),
                                    ),
                                    const SizedBox(height: 8),

                                    // Header with Playlist Name, Full Screen Toggle, and Drop Down
                                    Row(
                                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                      children: [
                                        Expanded(
                                          child: Column(
                                            crossAxisAlignment: CrossAxisAlignment.start,
                                            children: [
                                              Text(
                                                'PLAYING FROM',
                                                style: TextStyle(
                                                  fontSize: 10,
                                                  fontWeight: FontWeight.w800,
                                                  letterSpacing: 0.9,
                                                  color: AppTheme.getTextSecondary(context),
                                                ),
                                              ),
                                              const SizedBox(height: 1),
                                              ValueListenableBuilder<String?>(
                                                valueListenable: _music.activePlaylistName,
                                                builder: (ctx, plName, _) => Text(
                                                  plName ?? 'Music Library',
                                                  maxLines: 1,
                                                  overflow: TextOverflow.ellipsis,
                                                  style: TextStyle(
                                                    fontSize: 13,
                                                    fontWeight: FontWeight.bold,
                                                    color: AppTheme.getTextPrimary(context),
                                                  ),
                                                ),
                                              ),
                                            ],
                                          ),
                                        ),
                                        Row(
                                          mainAxisSize: MainAxisSize.min,
                                          children: [
                                            // Full Screen expand / collapse button
                                            IconButton(
                                              icon: Icon(
                                                isFullScreen ? Icons.fullscreen_exit_rounded : Icons.fullscreen_rounded,
                                                size: 26,
                                              ),
                                              color: isFullScreen
                                                  ? (AppTheme.isDark ? const Color(0xFF00E5FF) : AppTheme.primary)
                                                  : AppTheme.getTextSecondary(context),
                                              tooltip: isFullScreen ? 'Exit Full Screen' : 'Drop Up to Full Screen',
                                              onPressed: _toggleFullScreen,
                                            ),
                                            // Drop Down minimize button
                                            IconButton(
                                              icon: const Icon(Icons.keyboard_arrow_down_rounded, size: 30),
                                              color: AppTheme.getTextPrimary(context),
                                              tooltip: 'Minimize',
                                              onPressed: () => Navigator.pop(sheetInnerContext),
                                            ),
                                          ],
                                        ),
                                      ],
                                    ),
                                    SizedBox(height: isFullScreen ? 20 : 12),

                                    // Big Album Artwork with Cover Button
                                    Stack(
                                      alignment: Alignment.bottomRight,
                                      children: [
                                        AnimatedContainer(
                                          duration: const Duration(milliseconds: 250),
                                          curve: Curves.easeOutCubic,
                                          width: artworkSize,
                                          height: artworkSize,
                                          decoration: BoxDecoration(
                                            borderRadius: BorderRadius.circular(22),
                                            boxShadow: [
                                              BoxShadow(
                                                color: (AppTheme.isDark
                                                        ? const Color(0xFF7C3AED)
                                                        : AppTheme.primary)
                                                    .withValues(alpha: 0.38),
                                                blurRadius: 28,
                                                offset: const Offset(0, 12),
                                              ),
                                            ],
                                          ),
                                          child: ClipRRect(
                                            borderRadius: BorderRadius.circular(22),
                                            child: widget.buildCoverThumbnail(
                                              filename,
                                              size: artworkSize,
                                              isCurrentSong: false,
                                            ),
                                          ),
                                        ),
                                        Padding(
                                          padding: const EdgeInsets.all(10),
                                          child: ElevatedButton.icon(
                                            style: ElevatedButton.styleFrom(
                                              backgroundColor: Colors.black.withValues(alpha: 0.68),
                                              foregroundColor: Colors.white,
                                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                              textStyle: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold),
                                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                                            ),
                                            onPressed: () {
                                              Navigator.pop(sheetInnerContext);
                                              widget.onShowCoverArt(track);
                                            },
                                            icon: const Icon(Icons.image_search_rounded, size: 14),
                                            label: const Text('Cover'),
                                          ),
                                        ),
                                      ],
                                    ),
                                    SizedBox(height: isFullScreen ? 18 : 12),

                                    // Visualizer Animation
                                    _SoundWaveVisualizer(isPlaying: isPlaying),
                                    SizedBox(height: isFullScreen ? 16 : 10),

                                    // Track Title & Artist
                                    Text(
                                      title,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      textAlign: TextAlign.center,
                                      style: TextStyle(
                                        fontSize: isFullScreen ? 22 : 18,
                                        fontWeight: FontWeight.w800,
                                        color: AppTheme.getTextPrimary(context),
                                      ),
                                    ),
                                    const SizedBox(height: 3),
                                    Text(
                                      artist.isNotEmpty ? artist : 'Bip Singing Companion',
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      textAlign: TextAlign.center,
                                      style: TextStyle(
                                        fontSize: isFullScreen ? 14.5 : 13,
                                        fontWeight: FontWeight.w600,
                                        color: const Color(0xFF8B5CF6),
                                      ),
                                    ),
                                    SizedBox(height: isFullScreen ? 16 : 10),

                                    // Timeline slider
                                    SliderTheme(
                                      data: SliderTheme.of(context).copyWith(
                                        trackHeight: 4.5,
                                        thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 6),
                                        activeTrackColor: const Color(0xFF8B5CF6),
                                        inactiveTrackColor: AppTheme.isDark ? Colors.white12 : Colors.black12,
                                        thumbColor: const Color(0xFF8B5CF6),
                                      ),
                                      child: Slider(
                                        value: dur.inMilliseconds > 0
                                            ? (pos.inMilliseconds / dur.inMilliseconds).clamp(0.0, 1.0)
                                            : 0.0,
                                        onChanged: (val) {
                                          final targetMs = (val * dur.inMilliseconds).toInt();
                                          _music.seek(Duration(milliseconds: targetMs));
                                        },
                                      ),
                                    ),
                                    Padding(
                                      padding: const EdgeInsets.symmetric(horizontal: 12),
                                      child: Row(
                                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                        children: [
                                          Text(_formatDuration(pos),
                                              style: TextStyle(fontSize: 11, color: AppTheme.getTextSecondary(context))),
                                          Text(
                                            dur.inSeconds > 0 ? '-${_formatDuration(dur - pos)}' : '0:00',
                                            style: TextStyle(fontSize: 11, color: AppTheme.getTextSecondary(context)),
                                          ),
                                        ],
                                      ),
                                    ),
                                    SizedBox(height: isFullScreen ? 18 : 12),

                                    // Playback Controls Row
                                    Row(
                                      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                                      children: [
                                        // Shuffle
                                        ValueListenableBuilder<bool>(
                                          valueListenable: _music.isShuffle,
                                          builder: (ctx, isShuf, _) => IconButton(
                                            icon: Icon(
                                              Icons.shuffle_rounded,
                                              color: isShuf
                                                  ? const Color(0xFF8B5CF6)
                                                  : AppTheme.getTextSecondary(context),
                                              size: 26,
                                            ),
                                            padding: const EdgeInsets.all(8),
                                            constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
                                            tooltip: isShuf ? 'Shuffle On' : 'Shuffle Off',
                                            onPressed: _music.toggleShuffle,
                                          ),
                                        ),

                                        // Previous
                                        IconButton(
                                          icon: Icon(Icons.skip_previous_rounded,
                                              size: 38, color: AppTheme.getTextPrimary(context)),
                                          padding: const EdgeInsets.all(8),
                                          constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
                                          tooltip: 'Previous',
                                          onPressed: _music.previous,
                                        ),

                                        // Big Play / Pause Button
                                        Container(
                                          width: 66,
                                          height: 66,
                                          decoration: BoxDecoration(
                                            gradient: const LinearGradient(
                                              colors: [Color(0xFF7C3AED), Color(0xFFEC4899)],
                                            ),
                                            shape: BoxShape.circle,
                                            boxShadow: [
                                              BoxShadow(
                                                color: const Color(0xFF7C3AED).withValues(alpha: 0.4),
                                                blurRadius: 18,
                                                offset: const Offset(0, 6),
                                              ),
                                            ],
                                          ),
                                          child: IconButton(
                                            icon: Icon(
                                              isPlaying ? Icons.pause_rounded : Icons.play_arrow_rounded,
                                              size: 38,
                                              color: Colors.white,
                                            ),
                                            tooltip: isPlaying ? 'Pause' : 'Play',
                                            onPressed: _music.togglePlayPause,
                                          ),
                                        ),

                                        // Next
                                        IconButton(
                                          icon: Icon(Icons.skip_next_rounded,
                                              size: 38, color: AppTheme.getTextPrimary(context)),
                                          padding: const EdgeInsets.all(8),
                                          constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
                                          tooltip: 'Next',
                                          onPressed: _music.next,
                                        ),

                                        // Repeat
                                        ValueListenableBuilder<String>(
                                          valueListenable: _music.repeatMode,
                                          builder: (ctx, mode, _) => IconButton(
                                            icon: Icon(
                                              mode == 'one' ? Icons.repeat_one_rounded : Icons.repeat_rounded,
                                              color: mode != 'off'
                                                  ? const Color(0xFF8B5CF6)
                                                  : AppTheme.getTextSecondary(context),
                                              size: 26,
                                            ),
                                            padding: const EdgeInsets.all(8),
                                            constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
                                            tooltip: mode == 'one' ? 'Repeat One' : (mode == 'all' ? 'Repeat All' : 'Repeat Off'),
                                            onPressed: _music.toggleRepeatMode,
                                          ),
                                        ),
                                      ],
                                    ),
                                    SizedBox(height: isFullScreen ? 22 : 14),

                                    // Secondary Toolbar: Speed, Sleep, Crossfade, Offline
                                    SingleChildScrollView(
                                      scrollDirection: Axis.horizontal,
                                      child: Row(
                                        mainAxisAlignment: MainAxisAlignment.center,
                                        children: [
                                          // Speed chip
                                          ValueListenableBuilder<double>(
                                            valueListenable: _music.playbackRate,
                                            builder: (ctx, rate, _) => ActionChip(
                                              label: Text('${rate}x Speed',
                                                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                                              avatar: const Icon(Icons.speed_rounded, size: 16),
                                              onPressed: () {
                                                const rates = [1.0, 1.25, 1.5, 2.0, 0.75];
                                                final next = rates[(rates.indexOf(rate) + 1) % rates.length];
                                                _music.setPlaybackRate(next);
                                              },
                                            ),
                                          ),
                                          const SizedBox(width: 8),

                                          // Sleep timer chip
                                          ValueListenableBuilder<int?>(
                                            valueListenable: _music.sleepTimerRemaining,
                                            builder: (ctx, rem, _) => ActionChip(
                                              label: Text(
                                                rem != null ? '${(rem / 60).ceil()}m Sleep' : 'Sleep Timer',
                                                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                                              ),
                                              avatar: Icon(Icons.bedtime_outlined,
                                                  size: 16, color: rem != null ? Colors.amber : null),
                                              onPressed: widget.onShowSleepTimer,
                                            ),
                                          ),
                                          const SizedBox(width: 8),

                                          // Crossfade chip
                                          ValueListenableBuilder<int>(
                                            valueListenable: _music.crossfadeSeconds,
                                            builder: (ctx, fade, _) => ActionChip(
                                              label: Text(
                                                fade > 0 ? '${fade}s Fade' : 'Crossfade Off',
                                                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                                              ),
                                              avatar: const Icon(Icons.tune_rounded, size: 16),
                                              onPressed: () {
                                                const fades = [0, 3, 5, 8, 12];
                                                final next = fades[(fades.indexOf(fade) + 1) % fades.length];
                                                _music.setCrossfade(next);
                                              },
                                            ),
                                          ),
                                          const SizedBox(width: 8),

                                          // Offline download chip
                                          ValueListenableBuilder<Set<String>>(
                                            valueListenable: _music.offlineTrackFilenames,
                                            builder: (ctx, offlineSet, _) {
                                              final isOffline = offlineSet.contains(filename);
                                              return ActionChip(
                                                label: Text(
                                                  isOffline ? 'Saved Offline' : 'Save Offline',
                                                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                                                ),
                                                avatar: Icon(
                                                  isOffline ? Icons.offline_pin_rounded : Icons.download_rounded,
                                                  size: 16,
                                                  color: isOffline ? Colors.green : null,
                                                ),
                                                onPressed: () async {
                                                  if (isOffline) {
                                                    await _music.deleteOfflineTrack(filename);
                                                    if (context.mounted) {
                                                      ScaffoldMessenger.of(context).showSnackBar(
                                                        const SnackBar(content: Text('Removed offline audio file')),
                                                      );
                                                    }
                                                  } else {
                                                    final ok = await _music.downloadTrackOffline(track);
                                                    if (context.mounted) {
                                                      ScaffoldMessenger.of(context).showSnackBar(
                                                        SnackBar(
                                                          content: Text(ok
                                                              ? 'Song cached for offline listening!'
                                                              : 'Download failed'),
                                                        ),
                                                      );
                                                    }
                                                  }
                                                },
                                              );
                                            },
                                          ),
                                        ],
                                      ),
                                    ),
                                    const SizedBox(height: 12),
                                  ],
                                ),
                              ),
                            ),
                          );
                        },
                      );
                    },
                  );
                },
              );
            },
          );
        },
      ),
    );
  }
}
