import 'dart:async';
import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart' show Color;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
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
    });

    _durSub = _player.onDurationChanged.listen((dur) {
      duration.value = dur;
    });

    _compSub = _player.onPlayerComplete.listen((_) {
      _onTrackCompleted();
    });

    AppEvents.musicAction.addListener(_handleMusicAction);
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

  void _onTrackCompleted() {
    final idx = queueIndex.value;
    final list = queue.value;
    if (idx >= 0 && idx + 1 < list.length) {
      playTrackAt(idx + 1);
    } else {
      playerState.value = PlayerState.stopped;
      position.value = Duration.zero;
      _cancelNotification();
    }
  }

  /// Play a single song directly (adds to a 1-item queue)
  Future<void> playSong(Map<String, dynamic> song) async {
    queue.value = [song];
    queueIndex.value = 0;
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

    final targetIndex = (startIndex >= 0 && startIndex < tracks.length) ? startIndex : 0;
    queue.value = tracks;
    queueIndex.value = targetIndex;
    activePlaylistId.value = playlist['id'] as String?;
    activePlaylistName.value = playlist['name'] as String? ?? 'Playlist';

    await _startPlay(tracks[targetIndex]);
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
      final streamPath = '/api/music/stream/${Uri.encodeComponent(filename)}';
      final fullUrl = await _api.resolveUrl(streamPath);
      await _player.stop();
      await _player.play(UrlSource(fullUrl));
      _updateNotification();
    } catch (e) {
      debugPrint('[MusicService] Failed to play track: $e');
      rethrow;
    } finally {
      loading.value = false;
    }
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
    final idx = queueIndex.value;
    final list = queue.value;
    if (idx >= 0 && idx + 1 < list.length) {
      await playTrackAt(idx + 1);
    }
  }

  Future<void> previous() async {
    if (position.value.inSeconds > 3) {
      await seek(Duration.zero);
      return;
    }
    final idx = queueIndex.value;
    if (idx > 0) {
      await playTrackAt(idx - 1);
    } else {
      await seek(Duration.zero);
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
    _stateSub?.cancel();
    _posSub?.cancel();
    _durSub?.cancel();
    _compSub?.cancel();
    AppEvents.musicAction.removeListener(_handleMusicAction);
    _cancelNotification();
    _player.dispose();
  }
}
