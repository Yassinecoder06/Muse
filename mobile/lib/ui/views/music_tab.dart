import 'dart:async';
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
    try {
      final list = await _api.fetchMusicSongs();
      if (mounted) {
        setState(() {
          _songs = list;
          _loadingSongs = false;
        });
      }
    } catch (_) {
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

                    return Container(
                      padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
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
                            blurRadius: 16,
                            offset: const Offset(0, -4),
                          ),
                        ],
                      ),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          // Progress Slider
                          Row(
                            children: [
                              Text(posStr, style: TextStyle(fontSize: 10, color: AppTheme.getTextSecondary(context))),
                              Expanded(
                                child: SliderTheme(
                                  data: SliderTheme.of(context).copyWith(
                                    thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 4),
                                    overlayShape: const RoundSliderOverlayShape(overlayRadius: 8),
                                    trackHeight: 3,
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
                              Text(durStr, style: TextStyle(fontSize: 10, color: AppTheme.getTextSecondary(context))),
                            ],
                          ),

                          Row(
                            children: [
                              Container(
                                width: 36,
                                height: 36,
                                decoration: BoxDecoration(
                                  color: AppTheme.isDark
                                      ? const Color(0xFF00E5FF).withValues(alpha: 0.15)
                                      : AppTheme.primary.withValues(alpha: 0.12),
                                  borderRadius: BorderRadius.circular(8),
                                  border: Border.all(
                                    color: AppTheme.isDark
                                        ? const Color(0xFF00E5FF).withValues(alpha: 0.4)
                                        : AppTheme.primary.withValues(alpha: 0.3),
                                  ),
                                ),
                                child: Icon(
                                  Icons.music_note_rounded,
                                  color: AppTheme.isDark ? const Color(0xFF00E5FF) : AppTheme.primary,
                                  size: 20,
                                ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Text(
                                      title,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(
                                        fontSize: 13,
                                        fontWeight: FontWeight.bold,
                                        color: AppTheme.getTextPrimary(context),
                                      ),
                                    ),
                                    ValueListenableBuilder<String?>(
                                      valueListenable: _music.activePlaylistName,
                                      builder: (context, plName, _) {
                                        final sub = artist.isNotEmpty
                                            ? (plName != null ? '$artist • $plName' : artist)
                                            : (plName ?? '');
                                        if (sub.isEmpty) return const SizedBox.shrink();
                                        return Text(
                                          sub,
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: TextStyle(fontSize: 11, color: AppTheme.getTextSecondary(context)),
                                        );
                                      },
                                    ),
                                  ],
                                ),
                              ),

                              // Previous Track Button
                              IconButton(
                                icon: const Icon(Icons.skip_previous_rounded, size: 24),
                                color: AppTheme.getTextPrimary(context),
                                onPressed: _music.previous,
                              ),

                              // Play / Pause Button
                              ValueListenableBuilder<bool>(
                                valueListenable: _music.loading,
                                builder: (context, isLoading, _) {
                                  if (isLoading) {
                                    return SizedBox(
                                      width: 32,
                                      height: 32,
                                      child: Center(
                                        child: SizedBox(
                                          width: 18,
                                          height: 18,
                                          child: CircularProgressIndicator(
                                            strokeWidth: 2,
                                            color: AppTheme.isDark ? const Color(0xFF00E5FF) : AppTheme.primary,
                                          ),
                                        ),
                                      ),
                                    );
                                  }
                                  return IconButton(
                                    icon: Icon(
                                      isPlaying ? Icons.pause_circle_filled_rounded : Icons.play_circle_filled_rounded,
                                      color: AppTheme.isDark ? const Color(0xFF00E5FF) : AppTheme.primary,
                                      size: 32,
                                    ),
                                    onPressed: _music.togglePlayPause,
                                  );
                                },
                              ),

                              // Next Track Button
                              IconButton(
                                icon: const Icon(Icons.skip_next_rounded, size: 24),
                                color: AppTheme.getTextPrimary(context),
                                onPressed: _music.next,
                              ),

                              // Stop / Close Button
                              IconButton(
                                icon: Icon(Icons.close_rounded, size: 20, color: AppTheme.getTextSecondary(context)),
                                onPressed: _music.stop,
                              ),
                            ],
                          ),
                        ],
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
                            leading: Container(
                              width: 40,
                              height: 40,
                              decoration: BoxDecoration(
                                color: isCurrentSong
                                    ? (AppTheme.isDark ? const Color(0xFF00E5FF).withValues(alpha: 0.2) : AppTheme.primary.withValues(alpha: 0.15))
                                    : (AppTheme.isDark ? AppTheme.primaryLight.withValues(alpha: 0.15) : Colors.grey.withValues(alpha: 0.15)),
                                borderRadius: BorderRadius.circular(10),
                                border: isCurrentSong
                                    ? Border.all(color: AppTheme.isDark ? const Color(0xFF00E5FF).withValues(alpha: 0.6) : AppTheme.primary)
                                    : null,
                              ),
                              child: Icon(
                                isCurrentSong && isPlaying ? Icons.pause_rounded : Icons.play_arrow_rounded,
                                color: isCurrentSong
                                    ? (AppTheme.isDark ? const Color(0xFF00E5FF) : AppTheme.primary)
                                    : (AppTheme.isDark ? AppTheme.primaryLight : AppTheme.primary),
                                size: 22,
                              ),
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
                                  const SizedBox(width: 8),
                                ],
                                if (sizeFormatted.isNotEmpty)
                                  Text(
                                    sizeFormatted,
                                    style: TextStyle(fontSize: 11, color: AppTheme.getTextSecondary(context)),
                                  ),
                              ],
                            ),
                            trailing: PopupMenuButton<String>(
                              icon: Icon(Icons.more_vert, size: 20, color: AppTheme.getTextSecondary(context)),
                              onSelected: (val) {
                                if (val == 'play') {
                                  _music.playSong(song, contextQueue: filtered);
                                } else if (val == 'add_playlist') {
                                  _addSongToPlaylistModal(song);
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
