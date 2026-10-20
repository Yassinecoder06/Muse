import 'dart:async';
import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';
import '../../data/services/api_service.dart';
import '../../data/services/app_events.dart';
import '../theme/app_theme.dart';
import '../widgets/bip_voice_sheet.dart';

class MusicTab extends StatefulWidget {
  const MusicTab({super.key});

  @override
  State<MusicTab> createState() => _MusicTabState();
}

class _MusicTabState extends State<MusicTab> {
  final ApiService _api = ApiService();

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

  // Audio Playback State
  AudioPlayer? _player;
  String? _currentFilename;
  String? _currentTitle;
  String? _currentArtist;
  PlayerState _playerState = PlayerState.stopped;
  Duration _position = Duration.zero;
  Duration _duration = Duration.zero;
  bool _loadingAudio = false;

  StreamSubscription? _stateSub;
  StreamSubscription? _positionSub;
  StreamSubscription? _durationSub;
  StreamSubscription? _completeSub;

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

  void _initAudioPlayer() {
    if (_player != null) return;
    try {
      final p = AudioPlayer();
      _stateSub = p.onPlayerStateChanged.listen((state) {
        if (mounted) setState(() => _playerState = state);
      });
      _positionSub = p.onPositionChanged.listen((pos) {
        if (mounted) setState(() => _position = pos);
      });
      _durationSub = p.onDurationChanged.listen((dur) {
        if (mounted) setState(() => _duration = dur);
      });
      _completeSub = p.onPlayerComplete.listen((_) {
        if (mounted) {
          setState(() {
            _playerState = PlayerState.stopped;
            _position = Duration.zero;
          });
        }
      });
      _player = p;
    } catch (_) {}
  }

  @override
  void dispose() {
    AppEvents.dataChanged.removeListener(_onDataChanged);
    _tasksPollTimer?.cancel();
    _searchController.dispose();
    _downloadUrlController.dispose();
    _stateSub?.cancel();
    _positionSub?.cancel();
    _durationSub?.cancel();
    _completeSub?.cancel();
    _player?.dispose();
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

  Future<void> _playSong(Map<String, dynamic> song) async {
    final filename = song['filename'] as String? ?? '';
    final title = song['title'] as String? ?? filename;
    final artist = song['artist'] as String? ?? '';
    if (filename.isEmpty) return;

    _initAudioPlayer();

    if (_currentFilename == filename) {
      if (_playerState == PlayerState.playing) {
        await _player?.pause();
      } else {
        await _player?.resume();
      }
      return;
    }

    setState(() {
      _loadingAudio = true;
      _currentFilename = filename;
      _currentTitle = title;
      _currentArtist = artist;
      _position = Duration.zero;
      _duration = Duration.zero;
    });

    try {
      final streamPath = '/api/music/stream/${Uri.encodeComponent(filename)}';
      final fullUrl = await _api.resolveUrl(streamPath);
      await _player?.stop();
      await _player?.play(UrlSource(fullUrl));
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to play "$title": $e'), backgroundColor: Colors.redAccent),
        );
      }
    } finally {
      if (mounted) setState(() => _loadingAudio = false);
    }
  }

  Future<void> _stopPlayback() async {
    await _player?.stop();
    if (mounted) {
      setState(() {
        _currentFilename = null;
        _currentTitle = null;
        _currentArtist = null;
        _position = Duration.zero;
        _duration = Duration.zero;
        _playerState = PlayerState.stopped;
      });
    }
  }

  String _formatDuration(Duration d) {
    final minutes = d.inMinutes.remainder(60).toString().padLeft(2, '0');
    final seconds = d.inSeconds.remainder(60).toString().padLeft(2, '0');
    return '$minutes:$seconds';
  }

  Future<void> _deleteSong(String filename, String title) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.surface,
        title: const Text('Delete Song?', style: TextStyle(color: AppTheme.textPrimary)),
        content: Text('Are you sure you want to delete "$title" from your remote library?',
            style: const TextStyle(color: AppTheme.textSecondary)),
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
        if (_currentFilename == filename) {
          await _stopPlayback();
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
        backgroundColor: AppTheme.surface,
        title: const Text('New Playlist', style: TextStyle(color: AppTheme.textPrimary)),
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
        backgroundColor: AppTheme.surface,
        title: const Text('Delete Playlist?', style: TextStyle(color: AppTheme.textPrimary)),
        content: Text('Are you sure you want to delete playlist "$name"?',
            style: const TextStyle(color: AppTheme.textSecondary)),
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

  void _showPlaylistTracks(Map<String, dynamic> playlist) {
    final name = playlist['name'] as String? ?? 'Playlist';
    final tracks = playlist['tracks'] as List<dynamic>? ?? [];

    showModalBottomSheet(
      context: context,
      backgroundColor: AppTheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Text(
                    name,
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
                  ),
                ),
                Text(
                  '${tracks.length} track${tracks.length == 1 ? '' : 's'}',
                  style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary),
                ),
              ],
            ),
            const SizedBox(height: 14),
            if (tracks.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Center(
                  child: Text(
                    'No tracks in this playlist yet.\nAdd songs from the Library tab.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
                  ),
                ),
              )
            else
              Flexible(
                child: ListView.separated(
                  shrinkWrap: true,
                  itemCount: tracks.length,
                  separatorBuilder: (_, _) => const Divider(height: 1, color: AppTheme.surfaceBorder),
                  itemBuilder: (ctx, index) {
                    final track = tracks[index] as Map<String, dynamic>;
                    final tTitle = track['title'] as String? ?? 'Track ${index + 1}';
                    final tArtist = track['artist'] as String? ?? '';
                    final tFilename = track['filename'] as String? ?? '';
                    final isPlaying = _currentFilename == tFilename && _playerState == PlayerState.playing;

                    return ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      onTap: () {
                        Navigator.pop(ctx);
                        _playSong(track);
                      },
                      leading: Icon(
                        isPlaying ? Icons.pause_circle_filled_rounded : Icons.play_circle_filled_rounded,
                        color: isPlaying ? const Color(0xFF00E5FF) : AppTheme.primaryLight,
                        size: 24,
                      ),
                      title: Text(
                        tTitle,
                        style: TextStyle(
                          color: isPlaying ? const Color(0xFF00E5FF) : AppTheme.textPrimary,
                          fontSize: 14,
                          fontWeight: isPlaying ? FontWeight.bold : FontWeight.normal,
                        ),
                      ),
                      subtitle: tArtist.isNotEmpty
                          ? Text(tArtist, style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12))
                          : null,
                    );
                  },
                ),
              ),
          ],
        ),
      ),
    );
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
                  gradient: const LinearGradient(
                    colors: [Color(0xFF261E38), Color(0xFF191A26)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: const Color(0xFF00E5FF).withValues(alpha: 0.3)),
                ),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(6),
                      decoration: BoxDecoration(
                        color: const Color(0xFF00E5FF).withValues(alpha: 0.15),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.mic_rounded, color: Color(0xFF00E5FF), size: 16),
                    ),
                    const SizedBox(width: 10),
                    const Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Dictate Music to Bip',
                            style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.bold,
                              color: AppTheme.textPrimary,
                            ),
                          ),
                          Text(
                            'Say "Download songs by Queen" or "Sing a tune"',
                            style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                          ),
                        ],
                      ),
                    ),
                    const Icon(Icons.arrow_forward_ios_rounded, size: 12, color: AppTheme.textSecondary),
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
    if (_currentFilename == null) return const SizedBox.shrink();

    final isPlaying = _playerState == PlayerState.playing;
    final posStr = _formatDuration(_position);
    final durStr = _formatDuration(_duration);

    return Container(
      padding: const EdgeInsets.fromLTRB(16, 6, 16, 10),
      decoration: BoxDecoration(
        color: const Color(0xFF161524),
        border: const Border(
          top: BorderSide(color: Color(0xFF2C2840), width: 1.5),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.5),
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
              Text(posStr, style: const TextStyle(fontSize: 10, color: AppTheme.textSecondary)),
              Expanded(
                child: SliderTheme(
                  data: SliderTheme.of(context).copyWith(
                    thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 4),
                    overlayShape: const RoundSliderOverlayShape(overlayRadius: 8),
                    trackHeight: 3,
                    activeTrackColor: const Color(0xFF00E5FF),
                    inactiveTrackColor: Colors.white12,
                    thumbColor: const Color(0xFF00E5FF),
                  ),
                  child: Slider(
                    value: _duration.inMilliseconds > 0
                        ? (_position.inMilliseconds / _duration.inMilliseconds).clamp(0.0, 1.0)
                        : 0.0,
                    onChanged: (val) {
                      final targetMs = (val * _duration.inMilliseconds).toInt();
                      _player?.seek(Duration(milliseconds: targetMs));
                    },
                  ),
                ),
              ),
              Text(durStr, style: const TextStyle(fontSize: 10, color: AppTheme.textSecondary)),
            ],
          ),

          Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: const Color(0xFF00E5FF).withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: const Color(0xFF00E5FF).withValues(alpha: 0.4)),
                ),
                child: const Icon(Icons.music_note_rounded, color: Color(0xFF00E5FF), size: 20),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      _currentTitle ?? 'Now Playing',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
                    ),
                    if (_currentArtist != null && _currentArtist!.isNotEmpty)
                      Text(
                        _currentArtist!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                      ),
                  ],
                ),
              ),
              IconButton(
                icon: _loadingAudio
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF00E5FF)))
                    : Icon(
                        isPlaying ? Icons.pause_circle_filled_rounded : Icons.play_circle_filled_rounded,
                        color: const Color(0xFF00E5FF),
                        size: 32,
                      ),
                onPressed: () {
                  if (isPlaying) {
                    _player?.pause();
                  } else {
                    _player?.resume();
                  }
                },
              ),
              IconButton(
                icon: const Icon(Icons.close_rounded, size: 20, color: AppTheme.textSecondary),
                onPressed: _stopPlayback,
              ),
            ],
          ),
        ],
      ),
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
          // Search & Count bar
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            child: TextField(
              controller: _searchController,
              onChanged: (val) => setState(() => _songSearch = val.trim()),
              decoration: InputDecoration(
                hintText: 'Search songs or artists…',
                prefixIcon: const Icon(Icons.search, size: 20, color: AppTheme.textSecondary),
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
                    const Text('No songs in your library yet',
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
                    const SizedBox(height: 6),
                    const Text('Use Downloader or dictate to Bip to add songs',
                        style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
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
            const Expanded(
              child: Center(
                child: Text('No matching songs found', style: TextStyle(color: AppTheme.textSecondary)),
              ),
            )
          else
            Expanded(
              child: ListView.separated(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                itemCount: filtered.length,
                separatorBuilder: (_, _) => const Divider(height: 1, color: AppTheme.surfaceBorder),
                itemBuilder: (ctx, index) {
                  final song = filtered[index];
                  final filename = song['filename'] as String? ?? '';
                  final title = song['title'] as String? ?? filename;
                  final artist = song['artist'] as String? ?? '';
                  final sizeFormatted = _formatSize(song['size']);
                  final isCurrentSong = _currentFilename == filename;

                  return ListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    onTap: () => _playSong(song),
                    leading: InkWell(
                      onTap: () => _playSong(song),
                      borderRadius: BorderRadius.circular(10),
                      child: Container(
                        width: 40,
                        height: 40,
                        decoration: BoxDecoration(
                          color: isCurrentSong
                              ? const Color(0xFF00E5FF).withValues(alpha: 0.2)
                              : AppTheme.primaryLight.withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(10),
                          border: isCurrentSong ? Border.all(color: const Color(0xFF00E5FF).withValues(alpha: 0.6)) : null,
                        ),
                        child: isCurrentSong && _loadingAudio
                            ? const Center(child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF00E5FF))))
                            : Icon(
                                isCurrentSong && _playerState == PlayerState.playing
                                    ? Icons.pause_rounded
                                    : Icons.play_arrow_rounded,
                                color: isCurrentSong ? const Color(0xFF00E5FF) : AppTheme.primaryLight,
                                size: 22,
                              ),
                      ),
                    ),
                    title: Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 14,
                        color: isCurrentSong ? const Color(0xFF00E5FF) : AppTheme.textPrimary,
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
                              style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                            ),
                          ),
                          const SizedBox(width: 8),
                        ],
                        if (sizeFormatted.isNotEmpty)
                          Text(
                            sizeFormatted,
                            style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                          ),
                      ],
                    ),
                    trailing: PopupMenuButton<String>(
                      icon: const Icon(Icons.more_vert, size: 20, color: AppTheme.textSecondary),
                      onSelected: (val) {
                        if (val == 'play') {
                          _playSong(song);
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
                                isCurrentSong && _playerState == PlayerState.playing ? Icons.pause_rounded : Icons.play_arrow_rounded,
                                color: AppTheme.primaryLight,
                                size: 18,
                              ),
                              const SizedBox(width: 8),
                              Text(isCurrentSong && _playerState == PlayerState.playing ? 'Pause' : 'Play Song'),
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
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  '${_playlists.length} Playlist${_playlists.length == 1 ? '' : 's'}',
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: AppTheme.textSecondary),
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
                    const Text('No playlists created yet',
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
                    const SizedBox(height: 6),
                    const Text('Group your favorite tracks into custom collections',
                        style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
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
              child: ListView.separated(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                itemCount: _playlists.length,
                separatorBuilder: (_, _) => const SizedBox(height: 8),
                itemBuilder: (ctx, index) {
                  final pl = _playlists[index];
                  final id = pl['id'] as String? ?? '';
                  final name = pl['name'] as String? ?? 'Untitled';
                  final tracks = pl['tracks'] as List<dynamic>? ?? [];

                  return Card(
                    child: ListTile(
                      onTap: () => _showPlaylistTracks(pl),
                      leading: Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFF4081).withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: const Icon(Icons.playlist_play_rounded, color: Color(0xFFFF4081), size: 22),
                      ),
                      title: Text(
                        name,
                        style: const TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
                      ),
                      subtitle: Text(
                        '${tracks.length} track${tracks.length == 1 ? '' : 's'}',
                        style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                      ),
                      trailing: IconButton(
                        icon: const Icon(Icons.delete_outline, size: 20, color: Colors.redAccent),
                        onPressed: () => _deletePlaylist(id, name),
                      ),
                    ),
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
                        style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: AppTheme.textPrimary),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'Paste a YouTube URL, SoundCloud link, or song name with artist to download directly to your library.',
                    style: TextStyle(fontSize: 12, color: AppTheme.textSecondary, height: 1.3),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _downloadUrlController,
                    decoration: const InputDecoration(
                      hintText: 'https://youtube.com/watch?v=... or artist - song',
                      prefixIcon: Icon(Icons.link_rounded, size: 20, color: AppTheme.textSecondary),
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
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Download Queue & History',
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: AppTheme.textSecondary),
              ),
              IconButton(
                icon: const Icon(Icons.refresh, size: 18, color: AppTheme.textSecondary),
                onPressed: () => _loadTasks(silent: false),
              ),
            ],
          ),
          const SizedBox(height: 8),

          if (_loadingTasks && _tasks.isEmpty)
            const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator()))
          else if (_tasks.isEmpty)
            const Card(
              child: Padding(
                padding: EdgeInsets.symmetric(vertical: 24, horizontal: 16),
                child: Center(
                  child: Text('No active or recent download tasks',
                      style: TextStyle(color: AppTheme.textSecondary, fontSize: 13)),
                ),
              ),
            )
          else
            ..._tasks.map((task) {
              final id = task['id'] as String? ?? '';
              final title = task['title'] as String? ?? task['query'] as String? ?? 'Track';
              final status = task['status'] as String? ?? 'queued';
              final progress = (task['progress'] as num?)?.toDouble() ?? 0.0;
              final error = task['error'] as String?;

              Color badgeColor = Colors.grey;
              if (status == 'downloading' || status == 'converting') {
                badgeColor = Colors.amber;
              } else if (status == 'completed') {
                badgeColor = Colors.greenAccent;
              } else if (status == 'failed') {
                badgeColor = Colors.redAccent;
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
                          Expanded(
                            child: Text(
                              title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13, color: AppTheme.textPrimary),
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: badgeColor.withValues(alpha: 0.15),
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(color: badgeColor.withValues(alpha: 0.4)),
                            ),
                            child: Text(
                              status.toUpperCase(),
                              style: TextStyle(color: badgeColor, fontSize: 10, fontWeight: FontWeight.bold),
                            ),
                          ),
                          const SizedBox(width: 4),
                          IconButton(
                            icon: const Icon(Icons.close, size: 16, color: AppTheme.textSecondary),
                            onPressed: () async {
                              await _api.deleteMusicTask(id);
                              _loadTasks(silent: true);
                            },
                          ),
                        ],
                      ),
                      if (status == 'downloading' || status == 'converting') ...[
                        const SizedBox(height: 8),
                        ClipRRect(
                          borderRadius: BorderRadius.circular(4),
                          child: LinearProgressIndicator(
                            value: progress > 0 ? (progress / 100.0) : null,
                            minHeight: 4,
                          ),
                        ),
                      ],
                      if (error != null && error.isNotEmpty) ...[
                        const SizedBox(height: 6),
                        Text(
                          error,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 11, color: Colors.redAccent),
                        ),
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
