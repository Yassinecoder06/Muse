import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:muse_mobile/data/services/app_events.dart';
import 'package:muse_mobile/data/services/music_service.dart';
import 'package:muse_mobile/data/services/voice_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('com.ryanheise.just_audio.methods'),
      (MethodCall methodCall) async {
        if (methodCall.method == 'init') {
          return {'id': 'test-player'};
        }
        return {};
      },
    );
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('com.ryanheise.audio_session'),
      (MethodCall methodCall) async => null,
    );
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('plugins.flutter.io/path_provider'),
      (MethodCall methodCall) async => '/tmp',
    );
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('plugin.csdcorp.com/speech_to_text'),
      (MethodCall methodCall) async {
        if (methodCall.method == 'has_permission') return true;
        if (methodCall.method == 'initialize') return true;
        if (methodCall.method == 'listen') return true;
        if (methodCall.method == 'stop') return true;
        if (methodCall.method == 'cancel') return true;
        return true;
      },
    );
  });

  group('VoiceService Pause and Text Preservation', () {
    test('isDictating starts false', () {
      final voice = VoiceService();
      expect(voice.isDictating, isFalse);
    });

    test('Dictate in two chunks with a long silence in between -> both chunks remain in the input', () async {
      final voice = VoiceService();
      String received = '';

      voice.setCommittedText('');
      await voice.startDictation(onText: (text) => received = text);

      // Chunk 1
      voice.handleSimulatedSpeech('Buy apples and oranges', isFinal: true);
      expect(received, 'Buy apples and oranges');
      expect(voice.committedText, 'Buy apples and oranges');

      // Long silence in between (platform stops session on pause)
      voice.handleSimulatedPause();
      expect(voice.committedText, 'Buy apples and oranges');

      // Chunk 2 after pause
      voice.handleSimulatedSpeech('and call the grocery store', isFinal: true);
      expect(received, 'Buy apples and oranges and call the grocery store');
      expect(voice.committedText, 'Buy apples and oranges and call the grocery store');
      await voice.stop();
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

    test('PlayerState enum and AppEvents music actions dispatch smoothly', () {
      final music = MusicService.instance;
      expect(PlayerState.values, containsAll([
        PlayerState.stopped,
        PlayerState.playing,
        PlayerState.paused,
        PlayerState.completed,
      ]));

      // Test AppEvents action handling
      AppEvents.musicAction.value = 'music_pause';
      expect(music.playerState.value, PlayerState.stopped);
    });
  });
}
