import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:audio_session/audio_session.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:just_audio/just_audio.dart';
import 'package:just_audio_background/just_audio_background.dart';
import 'package:path_provider/path_provider.dart';
import 'api_service.dart';
import 'app_events.dart';

enum PlayerState {
  stopped,
  playing,
  paused,
  completed,
}

class MusicService {
  MusicService._() {
    _init();
  }

  factory MusicService() => instance;
  static final MusicService instance = MusicService._();

  final ApiService _api = ApiService();
  final AudioPlayer _player = AudioPlayer();

  // State Notifiers
  final ValueNotifier<Map<String, dynamic>?> currentTrack = ValueNotifier(null);
  final ValueNotifier<PlayerState> playerState = ValueNotifier(PlayerState.stopped);
  final ValueNotifier<Duration> position = ValueNotifier(Duration.zero);
  final ValueNotifier<Duration> duration = ValueNotifier(Duration.zero);
  final ValueNotifier<List<Map<String, dynamic>>> queue = ValueNotifier([]);
  final ValueNotifier<int> queueIndex = ValueNotifier(-1);
  final ValueNotifier<String?> activePlaylistId = ValueNotifier(null);
  final ValueNotifier<String?> activePlaylistName = ValueNotifier(null);
  final ValueNotifier<bool> loading = ValueNotifier(false);

  // Advanced Music Features State
  final ValueNotifier<bool> isShuffle = ValueNotifier(false);
  final ValueNotifier<String> repeatMode = ValueNotifier('all'); // 'off', 'all', 'one'
  final ValueNotifier<double> playbackRate = ValueNotifier(1.0);
  final ValueNotifier<int?> sleepTimerRemaining = ValueNotifier(null);
  final ValueNotifier<dynamic> sleepTimerDuration = ValueNotifier(null); // 15, 30, 45, 60, 'track', or null
  final ValueNotifier<int> crossfadeSeconds = ValueNotifier(0);
  final ValueNotifier<Set<String>> offlineTrackFilenames = ValueNotifier({});
  final ValueNotifier<({int current, int total, bool active})> batchDownloadStatus =
      ValueNotifier((current: 0, total: 0, active: false));

  List<Map<String, dynamic>> _originalQueue = [];
  Timer? _sleepTimer;

  StreamSubscription? _playerStateSub;
  StreamSubscription? _posSub;
  StreamSubscription? _durSub;
  StreamSubscription? _indexSub;

  void _init() {
    _playerStateSub = _player.playerStateStream.listen((state) {
      if (state.processingState == ProcessingState.completed) {
        playerState.value = PlayerState.completed;
        _onTrackCompleted();
      } else if (state.playing) {
        playerState.value = PlayerState.playing;
      } else if (state.processingState == ProcessingState.idle) {
        playerState.value = PlayerState.stopped;
      } else {
        playerState.value = PlayerState.paused;
      }
    });

    _posSub = _player.positionStream.listen((pos) {
      position.value = pos;
      final fadeSec = crossfadeSeconds.value;
      final durSec = duration.value.inSeconds;
      if (fadeSec > 0 && durSec > fadeSec && pos.inSeconds >= durSec - fadeSec) {
        final remaining = max(0, durSec - pos.inSeconds);
        final factor = remaining / fadeSec;
        _player.setVolume(factor.clamp(0.0, 1.0));
      }
    });

    _durSub = _player.durationStream.listen((dur) {
      if (dur != null) {
        duration.value = dur;
      }
    });

    _indexSub = _player.currentIndexStream.listen((index) {
      if (index == null || index < 0 || index >= queue.value.length) return;
      if (queueIndex.value != index) {
        queueIndex.value = index;
        currentTrack.value = queue.value[index];
      }
    });

    AppEvents.musicAction.addListener(_handleMusicAction);
    refreshOfflineTracks();
  }

  void _handleMusicAction() {
    final action = AppEvents.musicAction.value;
    if (action == null) return;
    AppEvents.musicAction.value = null;

    switch (action) {
      case 'music_play':
        resume();
        break;
      case 'music_pause':
        pause();
        break;
      case 'music_next':
        next();
        break;
      case 'music_prev':
        previous();
        break;
    }
  }

  Future<Directory> _getOfflineDir() async {
    final appDir = await getApplicationDocumentsDirectory();
    final dir = Directory('${appDir.path}/offline_music');
    if (!dir.existsSync()) {
      dir.createSync(recursive: true);
    }
    return dir;
  }

  Future<void> refreshOfflineTracks() async {
    try {
      final dir = await _getOfflineDir();
      final files = dir.listSync().whereType<File>().map((f) => f.uri.pathSegments.last).toSet();
      offlineTrackFilenames.value = files;
    } catch (_) {}
  }

  bool isTrackOffline(String filename) {
    return offlineTrackFilenames.value.contains(filename);
  }

  Future<File> _cacheFile() async =>
      File('${(await getApplicationSupportDirectory()).path}/muse_songs_cache.json');

  Future<void> saveSongsCache(List<Map<String, dynamic>> songs) async {
    try {
      final file = await _cacheFile();
      await file.writeAsString(jsonEncode(songs));
    } catch (_) {}
  }

  Future<List<Map<String, dynamic>>?> loadSongsCache() async {
    try {
      final file = await _cacheFile();
      if (!await file.exists()) return null;
      final raw = await file.readAsString();
      final list = jsonDecode(raw) as List<dynamic>;
      return list.whereType<Map>().map((m) => m.cast<String, dynamic>()).toList();
    } catch (_) {
      return null;
    }
  }

  Future<File?> getOfflineCoverFile(String filename) async {
    try {
      final dir = await _getOfflineDir();
      final file = File('${dir.path}/$filename.cover.jpg');
      if (await file.exists()) return file;
    } catch (_) {}
    return null;
  }

  Future<bool> downloadTrackOffline(Map<String, dynamic> track) async {
    final filename = track['filename'] as String? ?? '';
    if (filename.isEmpty) return false;
    try {
      final dir = await _getOfflineDir();
      final file = File('${dir.path}/$filename');
      final streamPath = '/api/music/stream/${Uri.encodeComponent(filename)}';
      final fullUrl = await _api.resolveUrl(streamPath);
      final res = await http.get(Uri.parse(fullUrl));
      if (res.statusCode == 200) {
        await file.writeAsBytes(res.bodyBytes);
        try {
          final coverPath = '/api/music/cover/${Uri.encodeComponent(filename)}';
          final coverUrl = await _api.resolveUrl(coverPath);
          final coverRes = await http.get(Uri.parse(coverUrl));
          if (coverRes.statusCode == 200) {
            final coverFile = File('${dir.path}/$filename.cover.jpg');
            await coverFile.writeAsBytes(coverRes.bodyBytes);
          }
        } catch (_) {}
        await refreshOfflineTracks();
        return true;
      }
    } catch (e) {
      debugPrint('[MusicService] Failed to download offline track: $e');
    }
    return false;
  }

  Future<void> downloadAllOffline(List<Map<String, dynamic>> songs) async {
    final toDownload = songs.where((s) {
      final f = s['filename'] as String? ?? '';
      return f.isNotEmpty && !isTrackOffline(f);
    }).toList();

    if (toDownload.isEmpty) return;

    batchDownloadStatus.value = (current: 0, total: toDownload.length, active: true);
    for (int i = 0; i < toDownload.length; i++) {
      batchDownloadStatus.value = (current: i + 1, total: toDownload.length, active: true);
      await downloadTrackOffline(toDownload[i]);
    }
    batchDownloadStatus.value = (current: toDownload.length, total: toDownload.length, active: false);
  }

  Future<void> deleteOfflineTrack(String filename) async {
    try {
      final dir = await _getOfflineDir();
      final file = File('${dir.path}/$filename');
      if (file.existsSync()) {
        file.deleteSync();
      }
      final coverFile = File('${dir.path}/$filename.cover.jpg');
      if (coverFile.existsSync()) {
        coverFile.deleteSync();
      }
      await refreshOfflineTracks();
    } catch (_) {}
  }

  Future<void> _configureAudioSession() async {
    try {
      final session = await AudioSession.instance;
      await session.configure(const AudioSessionConfiguration.music());
    } catch (_) {}
  }

  Future<AudioSource> _buildAudioSource(Map<String, dynamic> track) async {
    final filename = track['filename'] as String? ?? '';
    final title = (track['title'] as String?)?.trim().isNotEmpty == true
        ? (track['title'] as String).trim()
        : (filename.isNotEmpty ? filename : 'Music');
    final artist = (track['artist'] as String?)?.trim().isNotEmpty == true
        ? (track['artist'] as String).trim()
        : (activePlaylistName.value ?? 'Muse Music');
    final album = (track['album'] as String?)?.trim().isNotEmpty == true
        ? (track['album'] as String).trim()
        : 'Muse';

    Uri? artUri;
    try {
      final offlineCover = await getOfflineCoverFile(filename);
      if (offlineCover != null && await offlineCover.exists()) {
        artUri = Uri.file(offlineCover.path);
      } else if (filename.isNotEmpty) {
        final coverPath = '/api/music/cover/${Uri.encodeComponent(filename)}';
        final resolvedUrl = await _api.resolveUrl(coverPath);
        artUri = Uri.tryParse(resolvedUrl);
      }
    } catch (_) {}

    final id = filename.isNotEmpty ? filename : '${title}_${DateTime.now().millisecondsSinceEpoch}';
    final mediaItem = MediaItem(
      id: id,
      title: title,
      artist: artist,
      album: album,
      artUri: artUri,
    );

    try {
      final offlineDir = await _getOfflineDir();
      final localFile = File('${offlineDir.path}/$filename');
      if (await localFile.exists()) {
        return AudioSource.file(localFile.path, tag: mediaItem);
      }
    } catch (_) {}

    final streamPath = '/api/music/stream/${Uri.encodeComponent(filename)}';
    final streamUrl = await _api.resolveUrl(streamPath);
    return AudioSource.uri(Uri.parse(streamUrl), tag: mediaItem);
  }

  Future<void> _startPlayQueue({required int startIndex}) async {
    final tracks = queue.value;
    if (tracks.isEmpty) return;
    final targetIndex = startIndex.clamp(0, tracks.length - 1);
    final track = tracks[targetIndex];

    loading.value = true;
    currentTrack.value = track;
    queueIndex.value = targetIndex;
    position.value = Duration.zero;
    duration.value = Duration.zero;

    try {
      await _configureAudioSession();
      try {
        final session = await AudioSession.instance;
        await session.setActive(true);
      } catch (_) {}

      await _player.stop();
      await _player.setVolume(1.0);

      final sources = await Future.wait(tracks.map(_buildAudioSource));
      await _player.setAudioSources(
        sources,
        initialIndex: targetIndex,
        initialPosition: Duration.zero,
      );

      await _player.setSpeed(playbackRate.value);
      _applyLoopMode();
      await _player.play();
    } catch (e) {
      debugPrint('[MusicService] Failed to play track: $e');
      rethrow;
    } finally {
      loading.value = false;
    }
  }

  Future<void> _rebuildPlaylistKeepPosition() async {
    final tracks = queue.value;
    if (tracks.isEmpty || currentTrack.value == null) return;
    try {
      final currentPos = _player.position;
      final isPlaying = _player.playing;
      final sources = await Future.wait(tracks.map(_buildAudioSource));
      await _player.setAudioSources(
        sources,
        initialIndex: queueIndex.value.clamp(0, tracks.length - 1),
        initialPosition: currentPos,
      );
      _applyLoopMode();
      if (isPlaying) {
        await _player.play();
      }
    } catch (_) {}
  }

  Future<void> _onTrackCompleted() async {
    if (sleepTimerDuration.value == 'track') {
      await stop();
      setSleepTimer(null);
      return;
    }

    if (repeatMode.value == 'one') {
      await seek(Duration.zero);
      await resume();
      return;
    }

    final idx = queueIndex.value;
    final list = queue.value;
    if (idx >= 0 && idx + 1 < list.length) {
      if (!_player.hasNext) {
        await playTrackAt(idx + 1);
      }
    } else {
      if (repeatMode.value == 'all' && list.isNotEmpty) {
        await playTrackAt(0);
      } else {
        playerState.value = PlayerState.stopped;
        position.value = Duration.zero;
      }
    }
  }

  /// Play a single song directly (or within a contextQueue if available)
  Future<void> playSong(
    Map<String, dynamic> song, {
    List<Map<String, dynamic>>? contextQueue,
  }) async {
    if (contextQueue != null && contextQueue.isNotEmpty) {
      _originalQueue = List.from(contextQueue);
      if (isShuffle.value) {
        final currentFile = song['filename'] as String? ?? '';
        final others = contextQueue.where((t) => t['filename'] != currentFile).toList();
        others.shuffle();
        queue.value = [song, ...others];
        queueIndex.value = 0;
      } else {
        queue.value = contextQueue;
        final currentFile = song['filename'] as String? ?? '';
        final idx = contextQueue.indexWhere((t) => t['filename'] == currentFile);
        queueIndex.value = idx != -1 ? idx : 0;
      }
    } else {
      queue.value = [song];
      _originalQueue = [song];
      queueIndex.value = 0;
    }
    activePlaylistId.value = null;
    activePlaylistName.value = null;
    await _startPlayQueue(startIndex: queueIndex.value);
  }

  /// Play an entire playlist starting at [startIndex]
  Future<void> playPlaylist(
    Map<String, dynamic> playlist, {
    int startIndex = 0,
  }) async {
    final rawTracks = playlist['tracks'] as List<dynamic>? ?? [];
    final tracks = rawTracks.map((t) => Map<String, dynamic>.from(t as Map)).toList();
    if (tracks.isEmpty) return;

    _originalQueue = List.from(tracks);
    activePlaylistId.value = playlist['id'] as String?;
    activePlaylistName.value = playlist['name'] as String? ?? 'Playlist';

    if (isShuffle.value) {
      final chosen = (startIndex >= 0 && startIndex < tracks.length) ? tracks[startIndex] : tracks[0];
      final others = tracks.where((t) => t['filename'] != chosen['filename']).toList();
      others.shuffle();
      queue.value = [chosen, ...others];
      queueIndex.value = 0;
      await _startPlayQueue(startIndex: 0);
    } else {
      final targetIndex = (startIndex >= 0 && startIndex < tracks.length) ? startIndex : 0;
      queue.value = tracks;
      queueIndex.value = targetIndex;
      await _startPlayQueue(startIndex: targetIndex);
    }
  }

  /// Play track at a specific index in current queue
  Future<void> playTrackAt(int index) async {
    final list = queue.value;
    if (index < 0 || index >= list.length) return;
    queueIndex.value = index;
    currentTrack.value = list[index];

    if (_player.audioSources.length == list.length) {
      try {
        await _player.seek(Duration.zero, index: index);
        await _player.play();
        return;
      } catch (_) {}
    }
    await _startPlayQueue(startIndex: index);
  }

  void toggleShuffle() {
    isShuffle.value = !isShuffle.value;
    if (isShuffle.value) {
      if (queue.value.length > 1) {
        _originalQueue = List.from(queue.value);
        final current = queueIndex.value >= 0 && queueIndex.value < queue.value.length
            ? queue.value[queueIndex.value]
            : queue.value[0];
        final others = queue.value.where((t) => t['filename'] != current['filename']).toList();
        others.shuffle();
        queue.value = [current, ...others];
        queueIndex.value = 0;
        _rebuildPlaylistKeepPosition();
      }
    } else {
      if (_originalQueue.isNotEmpty) {
        final current = currentTrack.value;
        queue.value = List.from(_originalQueue);
        if (current != null) {
          final idx = queue.value.indexWhere((t) => t['filename'] == current['filename']);
          queueIndex.value = idx != -1 ? idx : 0;
        }
        _rebuildPlaylistKeepPosition();
      }
    }
  }

  void _applyLoopMode() {
    try {
      switch (repeatMode.value) {
        case 'one':
          _player.setLoopMode(LoopMode.one);
          break;
        case 'all':
          _player.setLoopMode(LoopMode.all);
          break;
        case 'off':
        default:
          _player.setLoopMode(LoopMode.off);
          break;
      }
    } catch (_) {}
  }

  void toggleRepeatMode() {
    switch (repeatMode.value) {
      case 'off':
        repeatMode.value = 'all';
        break;
      case 'all':
        repeatMode.value = 'one';
        break;
      case 'one':
      default:
        repeatMode.value = 'off';
        break;
    }
    _applyLoopMode();
  }

  Future<void> setPlaybackRate(double rate) async {
    playbackRate.value = rate;
    try {
      await _player.setSpeed(rate);
    } catch (_) {}
  }

  void setSleepTimer(dynamic duration) {
    _sleepTimer?.cancel();
    _sleepTimer = null;

    if (duration == null) {
      sleepTimerDuration.value = null;
      sleepTimerRemaining.value = null;
      return;
    }

    if (duration == 'track') {
      sleepTimerDuration.value = 'track';
      sleepTimerRemaining.value = null;
      return;
    }

    if (duration is int) {
      sleepTimerDuration.value = duration;
      sleepTimerRemaining.value = duration * 60;
      _sleepTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
        if (sleepTimerRemaining.value != null && sleepTimerRemaining.value! > 0) {
          sleepTimerRemaining.value = sleepTimerRemaining.value! - 1;
          if (sleepTimerRemaining.value! <= 0) {
            timer.cancel();
            _sleepTimer = null;
            pause();
            sleepTimerDuration.value = null;
            sleepTimerRemaining.value = null;
          }
        }
      });
    }
  }

  void setCrossfade(int seconds) {
    crossfadeSeconds.value = seconds.clamp(0, 12);
  }

  Future<void> togglePlayPause() async {
    if (playerState.value == PlayerState.playing) {
      await pause();
    } else if (currentTrack.value != null) {
      await resume();
    }
  }

  Future<void> pause() async {
    try {
      await _player.pause();
    } catch (_) {}
  }

  Future<void> resume() async {
    try {
      final session = await AudioSession.instance;
      await session.setActive(true);
    } catch (_) {}
    try {
      await _player.play();
    } catch (_) {}
  }

  Future<void> stop() async {
    try {
      await _player.stop();
    } catch (_) {}
    currentTrack.value = null;
    queueIndex.value = -1;
    position.value = Duration.zero;
    duration.value = Duration.zero;
    playerState.value = PlayerState.stopped;
  }

  Future<void> next() async {
    final list = queue.value;
    if (list.isEmpty) return;
    if (_player.hasNext) {
      await _player.seekToNext();
      await _player.play();
    } else {
      if (repeatMode.value == 'off') {
        await pause();
        await seek(Duration.zero);
      } else {
        await playTrackAt(0);
      }
    }
  }

  Future<void> previous() async {
    if (position.value.inSeconds > 3) {
      await seek(Duration.zero);
      return;
    }
    if (_player.hasPrevious) {
      await _player.seekToPrevious();
      await _player.play();
    } else if (repeatMode.value == 'all' && queue.value.isNotEmpty) {
      await playTrackAt(queue.value.length - 1);
    } else {
      await seek(Duration.zero);
    }
  }

  Future<void> seek(Duration target) async {
    try {
      await _player.seek(target);
    } catch (_) {}
  }

  void updateQueue(List<Map<String, dynamic>> newTracks) {
    queue.value = newTracks;
    final current = currentTrack.value;
    if (current != null) {
      final currentFile = current['filename'] as String?;
      final newIdx = newTracks.indexWhere((t) => t['filename'] == currentFile);
      queueIndex.value = newIdx;
    }
    _rebuildPlaylistKeepPosition();
  }

  void dispose() {
    _sleepTimer?.cancel();
    _playerStateSub?.cancel();
    _posSub?.cancel();
    _durSub?.cancel();
    _indexSub?.cancel();
    AppEvents.musicAction.removeListener(_handleMusicAction);
    _player.dispose();
  }
}
