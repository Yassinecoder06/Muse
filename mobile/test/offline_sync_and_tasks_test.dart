import 'dart:io';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:muse_mobile/data/models/event.dart';
import 'package:muse_mobile/data/models/task.dart';
import 'package:muse_mobile/data/services/api_service.dart';
import 'package:muse_mobile/data/services/app_events.dart';
import 'package:muse_mobile/data/services/event_cache.dart';
import 'package:muse_mobile/data/services/music_service.dart';
import 'package:muse_mobile/data/services/offline_queue.dart';
import 'package:muse_mobile/data/services/task_cache.dart';
import 'package:shared_preferences/shared_preferences.dart';

class FakeFullServer extends ApiService {
  FakeFullServer() : super.base();
  bool online = true;
  final tasks = <String, TodoTask>{};
  final events = <String, CalendarEvent>{};
  var _taskId = 1;
  var _eventId = 1;

  void _check() {
    if (!online) throw const SocketException('offline');
  }

  @override
  Future<List<TodoTask>> fetchTasks({String? dueDate}) async {
    _check();
    return tasks.values.toList();
  }

  @override
  Future<TodoTask> createTask({
    required String title,
    String? dueDate,
    String? dueTime,
    String priority = 'medium',
    String? noteId,
    int? reminderMinutesBefore,
  }) async {
    _check();
    final task = TodoTask(
      id: 'task-srv-${_taskId++}',
      title: title,
      completed: false,
      dueDate: dueDate,
      dueTime: dueTime,
      priority: priority,
      noteId: noteId,
      reminderMinutesBefore: reminderMinutesBefore,
      reminderAt: reminderMinutesBefore != null && dueDate != null
          ? DateTime.tryParse('$dueDate ${dueTime ?? "09:00"}')
          : null,
    );
    return tasks[task.id] = task;
  }

  @override
  Future<TodoTask> updateTask(
    String taskId, {
    String? title,
    bool? completed,
    String? dueDate,
    String? dueTime,
    String? priority,
    int? reminderMinutesBefore,
    DateTime? reminderAt,
    bool clearReminder = false,
  }) async {
    _check();
    final current = tasks[taskId]!;
    final updated = current.copyWith(
      title: title,
      completed: completed,
      dueDate: dueDate,
      dueTime: dueTime,
      priority: priority,
      reminderMinutesBefore: clearReminder ? null : reminderMinutesBefore ?? current.reminderMinutesBefore,
      reminderAt: clearReminder ? null : reminderAt ?? current.reminderAt,
    );
    return tasks[taskId] = updated;
  }

  @override
  Future<void> toggleTaskCompleted(String taskId, bool completed) async {
    _check();
    tasks[taskId] = tasks[taskId]!.copyWith(completed: completed);
  }

  @override
  Future<void> deleteTask(String taskId) async {
    _check();
    tasks.remove(taskId);
  }

  @override
  Future<List<CalendarEvent>> fetchEvents({DateTime? from, DateTime? to}) async {
    _check();
    return events.values.toList();
  }

  @override
  Future<CalendarEvent> createEvent({
    required String title,
    String description = '',
    required DateTime startTime,
    DateTime? endTime,
    bool allDay = false,
    String location = '',
    String? noteId,
  }) async {
    _check();
    final event = CalendarEvent(
      id: 'event-srv-${_eventId++}',
      title: title,
      description: description,
      startTime: startTime,
      endTime: endTime,
      allDay: allDay,
      location: location,
      noteId: noteId,
    );
    return events[event.id] = event;
  }

  @override
  Future<CalendarEvent> updateEvent(
    String eventId, {
    String? title,
    String? description,
    DateTime? startTime,
    DateTime? endTime,
    bool? allDay,
    String? location,
    String? noteId,
  }) async {
    _check();
    final current = events[eventId]!;
    final updated = current.copyWith(
      title: title,
      description: description,
      startTime: startTime,
      endTime: endTime,
      allDay: allDay,
      location: location,
      noteId: noteId,
    );
    return events[eventId] = updated;
  }

  @override
  Future<void> deleteEvent(String eventId) async {
    _check();
    events.remove(eventId);
  }
}

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

  late FakeFullServer server;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    TaskCache.resetForTests(null);
    EventCache.resetForTests(null);
    await OfflineQueue.init();
    AppEvents.syncMessage.value = null;
    server = FakeFullServer();
  });

  group('TaskCache & EventCache direct tests', () {
    test('TaskCache saves, loads, gets, puts, and removes tasks', () async {
      final task1 = TodoTask(id: 't1', title: 'Buy groceries', completed: false, dueDate: '2026-10-25', dueTime: '15:00');
      final task2 = TodoTask(id: 't2', title: 'Prepare slides', completed: true);

      await TaskCache.saveTasks([task1, task2]);

      final loaded = await TaskCache.loadTasks();
      expect(loaded, isNotNull);
      expect(loaded!.length, 2);
      expect(loaded[0].id, 't1');
      expect(loaded[0].title, 'Buy groceries');
      expect(loaded[1].completed, true);

      // get single task
      final getT1 = await TaskCache.get('t1');
      expect(getT1?.title, 'Buy groceries');

      // put updated task
      await TaskCache.put(task1.copyWith(title: 'Buy fresh groceries'));
      final updatedT1 = await TaskCache.get('t1');
      expect(updatedT1?.title, 'Buy fresh groceries');

      // replace local id
      await TaskCache.replaceId('t1', task1.copyWith(id: 't1-server'));
      expect(await TaskCache.serverIdFor('t1'), 't1-server');
      expect(await TaskCache.get('t1'), isNull);
      expect(await TaskCache.get('t1-server'), isNotNull);

      // remove
      await TaskCache.remove('t2');
      expect(await TaskCache.get('t2'), isNull);
      expect((await TaskCache.loadTasks())!.length, 1);
    });

    test('EventCache saves, loads, gets, puts, and removes calendar events', () async {
      final now = DateTime.now();
      final ev1 = CalendarEvent(id: 'e1', title: 'Team Meeting', description: 'Weekly sync', startTime: now);
      final ev2 = CalendarEvent(id: 'e2', title: 'Doctor visit', description: 'Checkup', startTime: now.add(const Duration(days: 1)), allDay: true);

      await EventCache.saveEvents([ev1, ev2]);

      final loaded = await EventCache.loadEvents();
      expect(loaded, isNotNull);
      expect(loaded!.length, 2);
      expect(loaded[0].title, 'Team Meeting');
      expect(loaded[1].allDay, true);

      // put update
      await EventCache.put(ev1.copyWith(location: 'Room 402'));
      expect((await EventCache.get('e1'))?.location, 'Room 402');

      // replaceId
      await EventCache.replaceId('e1', ev1.copyWith(id: 'e1-server'));
      expect(await EventCache.serverIdFor('e1'), 'e1-server');

      // remove
      await EventCache.remove('e2');
      expect(await EventCache.get('e2'), isNull);
    });
  });

  group('Offline Tasks & Reminders', () {
    test('creating task offline computes reminder moment, caches it, and schedules alarm', () async {
      server.online = false;

      // Create a task due 2026-10-25 at 14:00 with reminder 15 minutes before
      final created = await OfflineQueue.createTask(
        server,
        title: 'Interview Candidate',
        dueDate: '2026-10-25',
        dueTime: '14:00',
        priority: 'high',
        reminderMinutesBefore: 15,
      );

      expect(created.isLocal, isTrue);
      expect(created.title, 'Interview Candidate');
      expect(created.priority, 'high');
      expect(created.reminderMinutesBefore, 15);
      expect(created.reminderAt, isNotNull);
      expect(created.reminderAt, DateTime(2026, 10, 25, 13, 45));

      // Task is persisted in TaskCache
      final cached = await TaskCache.get(created.id);
      expect(cached, isNotNull);
      expect(cached?.title, 'Interview Candidate');
      expect(cached?.reminderAt, DateTime(2026, 10, 25, 13, 45));

      // Overlay includes offline created task
      final overlaid = await OfflineQueue.overlayTasks([]);
      expect(overlaid.length, 1);
      expect(overlaid.first.id, created.id);

      // Reconnect and flush: syncs to server and replaces local id
      server.online = true;
      final synced = await OfflineQueue.flush(server);
      expect(synced, 1);
      expect(server.tasks.length, 1);
      final serverTask = server.tasks.values.first;
      expect(serverTask.title, 'Interview Candidate');
      expect(serverTask.priority, 'high');
      expect(serverTask.id.startsWith('task-srv-'), isTrue);

      // Alias exists in cache
      expect(await TaskCache.serverIdFor(created.id), serverTask.id);
    });

    test('updating task completion and reminders offline buffers correctly and replays', () async {
      server.online = true;
      final t = await server.createTask(title: 'Write Docs', dueDate: '2026-10-30', dueTime: '10:00');
      await TaskCache.saveTasks([t]);

      // Go offline
      server.online = false;
      await OfflineQueue.setTaskCompleted(server, t.id, true);

      // Check offline overlay
      var overlaid = await OfflineQueue.overlayTasks([t]);
      expect(overlaid.first.completed, isTrue);

      // Update reminder offline
      await OfflineQueue.queueTaskUpdate(t, reminderMinutesBefore: 30);
      overlaid = await OfflineQueue.overlayTasks([t]);
      expect(overlaid.first.reminderMinutesBefore, 30);
      expect(overlaid.first.reminderAt, DateTime(2026, 10, 30, 9, 30));

      // Back online & flush
      server.online = true;
      await OfflineQueue.flush(server);
      expect(server.tasks[t.id]!.completed, isTrue);
      expect(server.tasks[t.id]!.reminderMinutesBefore, 30);
    });

    test('deleting a task offline removes it from cache and overlays', () async {
      server.online = true;
      final t = await server.createTask(title: 'Temporary Task');
      await TaskCache.saveTasks([t]);

      // Go offline
      server.online = false;
      await OfflineQueue.deleteTask(server, t.id);

      expect(await TaskCache.get(t.id), isNull);
      final overlaid = await OfflineQueue.overlayTasks([t]);
      expect(overlaid, isEmpty);

      // Flush
      server.online = true;
      await OfflineQueue.flush(server);
      expect(server.tasks[t.id], isNull);
    });
  });

  group('Offline Calendar Events', () {
    test('creating event offline generates local id, caches it, and replays on flush', () async {
      server.online = false;
      final start = DateTime(2026, 11, 1, 16, 0);
      final end = DateTime(2026, 11, 1, 17, 0);

      final ev = await OfflineQueue.createEvent(
        server,
        title: 'Project Kickoff',
        startTime: start,
        endTime: end,
        location: 'Conference Room B',
        description: 'Initial planning session',
      );

      expect(ev.isLocal, isTrue);
      expect(ev.title, 'Project Kickoff');
      expect(ev.location, 'Conference Room B');

      // Check cache and overlay
      expect(await EventCache.get(ev.id), isNotNull);
      final overlaid = await OfflineQueue.overlayEvents([]);
      expect(overlaid.length, 1);
      expect(overlaid.first.title, 'Project Kickoff');

      // Go online and flush
      server.online = true;
      final sent = await OfflineQueue.flush(server);
      expect(sent, 1);
      expect(server.events.length, 1);
      final serverEvent = server.events.values.first;
      expect(serverEvent.title, 'Project Kickoff');
      expect(serverEvent.location, 'Conference Room B');
      expect(await EventCache.serverIdFor(ev.id), serverEvent.id);
    });

    test('deleting event offline buffers delete and clears on server', () async {
      server.online = true;
      final ev = await server.createEvent(title: 'Lunch with Bob', startTime: DateTime.now());
      await EventCache.saveEvents([ev]);

      // Offline delete
      server.online = false;
      await OfflineQueue.deleteEvent(server, ev.id);

      expect(await EventCache.get(ev.id), isNull);
      expect(await OfflineQueue.overlayEvents([ev]), isEmpty);

      server.online = true;
      await OfflineQueue.flush(server);
      expect(server.events[ev.id], isNull);
    });
  });

  group('Music Offline Cache', () {
    test('MusicService saves and loads cached songs', () async {
      final sampleSongs = [
        {'filename': 'track1.mp3', 'title': 'Lofi Study', 'artist': 'Bip'},
        {'filename': 'track2.mp3', 'title': 'Synthwave Dreams', 'artist': 'Muse'},
      ];

      await MusicService.instance.saveSongsCache(sampleSongs);
      final loaded = await MusicService.instance.loadSongsCache();

      expect(loaded, isNotNull);
      expect(loaded!.length, 2);
      expect(loaded[0]['title'], 'Lofi Study');
      expect(loaded[1]['artist'], 'Muse');
    });
  });
}
