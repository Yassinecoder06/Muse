import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:muse_mobile/data/services/music_service.dart';
import 'package:muse_mobile/data/services/voice_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('xyz.luan/audioplayers.global'),
      (MethodCall methodCall) async => 1,
    );
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('xyz.luan/audioplayers'),
      (MethodCall methodCall) async => 1,
    );
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('plugins.flutter.io/path_provider'),
      (MethodCall methodCall) async => '/tmp',
    );
  });

  group('VoiceService Pause and Text Preservation', () {
    test('isDictating starts false', () {
      final voice = VoiceService();
      expect(voice.isDictating, isFalse);
    });
  });

  group('MusicService Queue and Playback Order', () {
    test('queue starts empty and updates correctly', () {
      final music = MusicService.instance;
      expect(music.queue.value, isEmpty);

      final tracks = [
        {'filename': 'song1.mp3', 'title': 'First Song', 'artist': 'Artist A'},
        {'filename': 'song2.mp3', 'title': 'Second Song', 'artist': 'Artist B'},
        {'filename': 'song3.mp3', 'title': 'Third Song', 'artist': 'Artist C'},
      ];

      music.updateQueue(tracks);
      expect(music.queue.value.length, 3);
      expect(music.queue.value[0]['title'], 'First Song');
      expect(music.queue.value[1]['title'], 'Second Song');
      expect(music.queue.value[2]['title'], 'Third Song');

      // Reorder tracks (Playback Priority Order)
      final reordered = [
        tracks[2], // Third Song moves to #1 priority
        tracks[0], // First Song moves to #2
        tracks[1], // Second Song moves to #3
      ];
      music.updateQueue(reordered);

      expect(music.queue.value[0]['title'], 'Third Song');
      expect(music.queue.value[1]['title'], 'First Song');
      expect(music.queue.value[2]['title'], 'Second Song');
    });

    test('shuffle toggles properly and repeat cycles through modes', () {
      final music = MusicService.instance;
      expect(music.isShuffle.value, isFalse);
      music.toggleShuffle();
      expect(music.isShuffle.value, isTrue);
      music.toggleShuffle();
      expect(music.isShuffle.value, isFalse);

      // Repeat mode: starts at 'all'
      expect(music.repeatMode.value, 'all');
      music.toggleRepeatMode(); // 'one'
      expect(music.repeatMode.value, 'one');
      music.toggleRepeatMode(); // 'off'
      expect(music.repeatMode.value, 'off');
      music.toggleRepeatMode(); // 'all'
      expect(music.repeatMode.value, 'all');
    });

    test('playback rate, sleep timer, and crossfade update state', () async {
      final music = MusicService.instance;

      await music.setPlaybackRate(1.5);
      expect(music.playbackRate.value, 1.5);

      music.setCrossfade(5);
      expect(music.crossfadeSeconds.value, 5);

      music.setSleepTimer(15);
      expect(music.sleepTimerDuration.value, 15);
      expect(music.sleepTimerRemaining.value, 15 * 60);

      music.setSleepTimer('track');
      expect(music.sleepTimerDuration.value, 'track');
      expect(music.sleepTimerRemaining.value, isNull);

      music.setSleepTimer(null);
      expect(music.sleepTimerDuration.value, isNull);
      expect(music.sleepTimerRemaining.value, isNull);
    });
  });
}
