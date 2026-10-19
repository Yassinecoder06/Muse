import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:muse_mobile/data/models/event.dart';
import 'package:muse_mobile/data/models/note.dart';
import 'package:muse_mobile/data/models/task.dart';
import 'package:muse_mobile/data/services/api_service.dart';
import 'package:muse_mobile/data/services/offline_queue.dart';
import 'package:muse_mobile/data/services/reminder_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

class FakeApi extends ApiService {
  bool online = false;
  final created = <String>[];
  final toggled = <String, bool>{};

  @override
  Future<Note> createNote({required String title, required String content, List<String>? tags}) async {
    if (!online) throw const SocketException('offline');
    created.add(title);
    return Note(id: 'n${created.length}', title: title, content: content, tags: tags ?? [], favorite: false, updatedAt: '');
  }

  @override
  Future<void> toggleTaskCompleted(String taskId, bool completed) async {
    if (!online) throw const SocketException('offline');
    toggled[taskId] = completed;
  }
}

void main() {
  group('ReminderService.plan', () {
    final now = DateTime(2026, 10, 19, 12, 0);

    test('timed tasks fire at their time; date-only tasks at 9am', () {
      final plan = ReminderService.plan([
        TodoTask(id: 'a', title: 'Call bank', completed: false, dueDate: '2026-10-19', dueTime: '15:30'),
        TodoTask(id: 'b', title: 'Pay rent', completed: false, dueDate: '2026-10-20'),
        TodoTask(id: 'c', title: 'Done already', completed: true, dueDate: '2026-10-20', dueTime: '10:00'),
        TodoTask(id: 'd', title: 'Past', completed: false, dueDate: '2026-10-19', dueTime: '08:00'),
        TodoTask(id: 'e', title: 'PM format', completed: false, dueDate: '2026-10-19', dueTime: '3:00 PM'),
      ], [], now);
      expect(plan.map((r) => r.title), ['PM format', 'Call bank', 'Pay rent']);
      expect(plan.firstWhere((r) => r.title == 'Pay rent').at, DateTime(2026, 10, 20, 9));
      expect(plan.firstWhere((r) => r.title == 'PM format').at, DateTime(2026, 10, 19, 15));
    });

    test('events remind 10 minutes early; all-day events at 8am; far future skipped', () {
      final plan = ReminderService.plan([], [
        CalendarEvent(id: 'x', title: 'Gym', description: '', startTime: DateTime(2026, 10, 19, 18, 0), location: 'Club'),
        CalendarEvent(id: 'y', title: 'Holiday', description: '', startTime: DateTime(2026, 10, 21), allDay: true),
        CalendarEvent(id: 'z', title: 'Next year', description: '', startTime: DateTime(2027, 1, 1, 10)),
      ], now);
      expect(plan.map((r) => r.title), ['Gym', 'Holiday']);
      expect(plan.first.at, DateTime(2026, 10, 19, 17, 50));
      expect(plan.first.body, contains('Club'));
      expect(plan.last.at, DateTime(2026, 10, 21, 8));
    });
  });

  group('OfflineQueue', () {
    setUp(() => SharedPreferences.setMockInitialValues({}));

    test('queues while offline and replays in order once online', () async {
      final api = FakeApi();
      await OfflineQueue.init();

      expect(await OfflineQueue.createNote(api, title: 'First', content: ''), isFalse);
      expect(await OfflineQueue.setTaskCompleted(api, 't1', true), isFalse);
      expect(await OfflineQueue.createNote(api, title: 'Second', content: ''), isFalse);
      expect(OfflineQueue.pending.value, 3);

      expect(await OfflineQueue.flush(api), 0); // still offline: nothing lost
      expect(OfflineQueue.pending.value, 3);

      api.online = true;
      expect(await OfflineQueue.flush(api), 3);
      expect(api.created, ['First', 'Second']);
      expect(api.toggled, {'t1': true});
      expect(OfflineQueue.pending.value, 0);
    });

    test('server errors are not queued', () async {
      final api = _RejectingApi();
      await OfflineQueue.init();
      expect(() => OfflineQueue.createNote(api, title: 'x', content: ''), throwsException);
      expect(OfflineQueue.pending.value, 0);
    });
  });
}

class _RejectingApi extends ApiService {
  @override
  Future<Note> createNote({required String title, required String content, List<String>? tags}) async =>
      throw Exception('Failed to create note (400)');
}
