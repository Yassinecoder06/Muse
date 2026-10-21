import 'package:flutter_test/flutter_test.dart';
import 'package:muse_mobile/data/services/music_service.dart';
import 'package:muse_mobile/data/services/voice_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

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
  });
}
