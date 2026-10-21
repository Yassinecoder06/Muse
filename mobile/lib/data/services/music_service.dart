import 'dart:async';
import 'dart:io';
import 'dart:math';
import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart' show Color;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:path_provider/path_provider.dart';
import 'package:http/http.dart' as http;
import 'api_service.dart';
import 'app_events.dart';

class MusicService {
  MusicService._() {
    _init();
  }

  static final MusicService instance = MusicService._();

  final ApiService _api = ApiService();
  final AudioPlayer _player = AudioPlayer();
  final FlutterLocalNotificationsPlugin _notifications = FlutterLocalNotificationsPlugin();

  static const int _notificationId = 88888;
  static const String _channelId = 'muse_music_playback';
  static const String _channelName = 'Music Playback';

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

  List<Map<String, dynamic>> _originalQueue = [];
  Timer? _sleepTimer;

  StreamSubscription? _stateSub;
  StreamSubscription? _posSub;
  StreamSubscription? _durSub;
  StreamSubscription? _compSub;

  void _init() {
    // Configure audio context to hold wakelock for continuous playback when locked
    try {
      _player.setAudioContext(
        AudioContext(
          android: const AudioContextAndroid(
            stayAwake: true,
            contentType: AndroidContentType.music,
            usageType: AndroidUsageType.media,
            audioFocus: AndroidAudioFocus.gain,
          ),
          iOS: AudioContextIOS(
            category: AVAudioSessionCategory.playback,
            options: {AVAudioSessionOptions.defaultToSpeaker},
          ),
        ),
      );
    } catch (_) {}

    _stateSub = _player.onPlayerStateChanged.listen((state) {
      playerState.value = state;
      _updateNotification();
    });

    _posSub = _player.onPositionChanged.listen((pos) {
      position.value = pos;
      final fadeSec = crossfadeSeconds.value;
      final durSec = duration.value.inSeconds;
      if (fadeSec > 0 && durSec > fadeSec && pos.inSeconds >= durSec - fadeSec) {
        final remaining = max(0, durSec - pos.inSeconds);
        final factor = remaining / fadeSec;
        _player.setVolume(factor.clamp(0.0, 1.0));
      }
    });

    _durSub = _player.onDurationChanged.listen((dur) {
      duration.value = dur;
    });

    _compSub = _player.onPlayerComplete.listen((_) {
      _onTrackCompleted();
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
        await refreshOfflineTracks();
        return true;
      }
    } catch (e) {
      debugPrint('[MusicService] Failed to download offline track: $e');
    }
    return false;
  }

  Future<void> deleteOfflineTrack(String filename) async {
    try {
      final dir = await _getOfflineDir();
      final file = File('${dir.path}/$filename');
      if (file.existsSync()) {
        file.deleteSync();
      }
      await refreshOfflineTracks();
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
      await playTrackAt(idx + 1);
    } else {
      if (repeatMode.value == 'all' && list.isNotEmpty) {
        await playTrackAt(0);
      } else {
        playerState.value = PlayerState.stopped;
        position.value = Duration.zero;
        _cancelNotification();
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
    await _startPlay(song);
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
      await _startPlay(chosen);
    } else {
      final targetIndex = (startIndex >= 0 && startIndex < tracks.length) ? startIndex : 0;
      queue.value = tracks;
      queueIndex.value = targetIndex;
      await _startPlay(tracks[targetIndex]);
    }
  }

  /// Play track at a specific index in current queue
  Future<void> playTrackAt(int index) async {
    final list = queue.value;
    if (index < 0 || index >= list.length) return;
    queueIndex.value = index;
    await _startPlay(list[index]);
  }

  Future<void> _startPlay(Map<String, dynamic> track) async {
    final filename = track['filename'] as String? ?? '';
    if (filename.isEmpty) return;

    loading.value = true;
    currentTrack.value = track;
    position.value = Duration.zero;
    duration.value = Duration.zero;

    try {
      final offlineDir = await _getOfflineDir();
      final localFile = File('${offlineDir.path}/$filename');

      await _player.stop();
      await _player.setVolume(1.0);

      if (await localFile.exists()) {
        await _player.play(DeviceFileSource(localFile.path));
      } else {
        final streamPath = '/api/music/stream/${Uri.encodeComponent(filename)}';
        final fullUrl = await _api.resolveUrl(streamPath);
        await _player.play(UrlSource(fullUrl));
      }

      await _player.setPlaybackRate(playbackRate.value);
      _updateNotification();
    } catch (e) {
      debugPrint('[MusicService] Failed to play track: $e');
      rethrow;
    } finally {
      loading.value = false;
    }
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
      }
    } else {
      if (_originalQueue.isNotEmpty) {
        final current = currentTrack.value;
        queue.value = List.from(_originalQueue);
        if (current != null) {
          final idx = queue.value.indexWhere((t) => t['filename'] == current['filename']);
          queueIndex.value = idx != -1 ? idx : 0;
        }
      }
    }
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
  }

  Future<void> setPlaybackRate(double rate) async {
    playbackRate.value = rate;
    try {
      await _player.setPlaybackRate(rate);
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
    await _player.pause();
    _updateNotification();
  }

  Future<void> resume() async {
    await _player.resume();
    _updateNotification();
  }

  Future<void> stop() async {
    await _player.stop();
    currentTrack.value = null;
    queueIndex.value = -1;
    position.value = Duration.zero;
    duration.value = Duration.zero;
    playerState.value = PlayerState.stopped;
    _cancelNotification();
  }

  Future<void> next() async {
    final list = queue.value;
    if (list.isEmpty) return;
    final idx = queueIndex.value;
    if (idx >= 0 && idx + 1 < list.length) {
      await playTrackAt(idx + 1);
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
    final list = queue.value;
    if (list.isEmpty) return;
    final idx = queueIndex.value;
    if (idx > 0) {
      await playTrackAt(idx - 1);
    } else {
      await playTrackAt(list.length - 1);
    }
  }

  Future<void> seek(Duration target) async {
    await _player.seek(target);
  }

  void updateQueue(List<Map<String, dynamic>> newTracks) {
    queue.value = newTracks;
    final current = currentTrack.value;
    if (current != null) {
      final currentFile = current['filename'] as String?;
      final newIdx = newTracks.indexWhere((t) => t['filename'] == currentFile);
      queueIndex.value = newIdx;
    }
  }

  void _updateNotification() {
    final track = currentTrack.value;
    if (track == null) {
      _cancelNotification();
      return;
    }

    final isPlaying = playerState.value == PlayerState.playing;
    final title = track['title'] as String? ?? track['filename'] as String? ?? 'Music';
    final artist = track['artist'] as String? ?? activePlaylistName.value ?? 'Muse Music';

    final androidDetails = AndroidNotificationDetails(
      _channelId,
      _channelName,
      channelDescription: 'Media controls and currently playing song in Muse',
      importance: Importance.low,
      priority: Priority.low,
      ongoing: isPlaying,
      autoCancel: false,
      showWhen: false,
      category: AndroidNotificationCategory.transport,
      visibility: NotificationVisibility.public,
      color: const Color(0xFF7C3AED),
      actions: [
        const AndroidNotificationAction(
          'music_prev',
          'Prev',
          showsUserInterface: false,
        ),
        AndroidNotificationAction(
          isPlaying ? 'music_pause' : 'music_play',
          isPlaying ? 'Pause' : 'Play',
          showsUserInterface: false,
        ),
        const AndroidNotificationAction(
          'music_next',
          'Next',
          showsUserInterface: false,
        ),
      ],
    );

    const iosDetails = DarwinNotificationDetails(
      presentSound: false,
      presentAlert: false,
      presentBadge: false,
    );

    _notifications.show(
      id: _notificationId,
      title: title,
      body: artist,
      notificationDetails: NotificationDetails(android: androidDetails, iOS: iosDetails),
      payload: 'muse_music',
    );
  }

  void _cancelNotification() {
    _notifications.cancel(id: _notificationId);
  }

  void dispose() {
    _sleepTimer?.cancel();
    _stateSub?.cancel();
    _posSub?.cancel();
    _durSub?.cancel();
    _compSub?.cancel();
    AppEvents.musicAction.removeListener(_handleMusicAction);
    _cancelNotification();
    _player.dispose();
  }
}
