import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:intl/intl.dart';
import 'package:muse_mobile/main.dart';
import 'package:muse_mobile/data/models/note.dart';
import 'package:muse_mobile/data/models/task.dart';
import 'package:muse_mobile/data/models/event.dart';
import 'package:muse_mobile/data/services/api_service.dart';
import 'package:muse_mobile/data/services/event_cache.dart';
import 'package:muse_mobile/data/services/task_cache.dart';
import 'package:muse_mobile/ui/views/note_detail_view.dart';
import 'package:muse_mobile/ui/views/tasks_tab.dart';
import 'package:muse_mobile/ui/views/bip_chat_tab.dart';

class FakePathProviderPlatform extends PathProviderPlatform with MockPlatformInterfaceMixin {
  @override
  Future<String?> getTemporaryPath() async => '/tmp';

  @override
  Future<String?> getApplicationSupportPath() async => '/tmp';

  @override
  Future<String?> getLibraryPath() async => '/tmp';

  @override
  Future<String?> getApplicationDocumentsPath() async => '/tmp';

  @override
  Future<String?> getExternalStoragePath() async => '/tmp';

  @override
  Future<List<String>?> getExternalCachePaths() async => ['/tmp'];

  @override
  Future<List<String>?> getExternalStoragePaths({StorageDirectory? type}) async => ['/tmp'];

  @override
  Future<String?> getDownloadsPath() async => '/tmp';
}

class WidgetFakeApi extends ApiService {
  WidgetFakeApi() : super.base();

  @override
  Future<List<Map<String, dynamic>>> fetchChatSessions() async => [
        {
          'id': 's1',
          'title': 'Mobile Companion',
          'context_type': 'mobile',
          'created_at': DateTime.now().toIso8601String(),
          'updated_at': DateTime.now().toIso8601String(),
        }
      ];

  @override
  Future<Map<String, dynamic>> fetchChatSession(String id) async => {
        'id': 's1',
        'title': 'Mobile Companion',
        'messages': [
          {'id': 'm1', 'role': 'user', 'content': 'Hello Bip', 'created_at': DateTime.now().toIso8601String()},
          {'id': 'm2', 'role': 'assistant', 'content': 'You have 3 notes.', 'created_at': DateTime.now().toIso8601String()},
        ],
      };

  @override
  Future<List<Map<String, dynamic>>> fetchMemories() async => [];

  final List<TodoTask> tasksList = [
    TodoTask(
      id: 't-del-1',
      title: 'Task to be deleted',
      completed: false,
      dueDate: DateFormat('yyyy-MM-dd').format(DateTime.now()),
    ),
  ];

  @override
  Future<List<TodoTask>> fetchTasks({String? dueDate}) async => List.of(tasksList);

  @override
  Future<List<CalendarEvent>> fetchEvents({DateTime? from, DateTime? to}) async => [];

  @override
  Future<void> deleteTask(String id) async {
    tasksList.removeWhere((t) => t.id == id);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() {
    PathProviderPlatform.instance = FakePathProviderPlatform();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('plugins.flutter.io/path_provider'),
      (MethodCall methodCall) async => '/tmp',
    );
  });

  setUp(() {
    SharedPreferences.setMockInitialValues({'muse_server_url': 'http://muse.test'});
    TaskCache.disableDiskForTests = true;
    EventCache.disableDiskForTests = true;
    TaskCache.resetForTests(null);
    EventCache.resetForTests(null);
    ApiService.testOverride = WidgetFakeApi();
  });

  tearDown(() {
    ApiService.testOverride = null;
  });
  testWidgets('Muse app loads pairing screen when not paired', (WidgetTester tester) async {
    await tester.pumpWidget(const MuseMobileApp(initialPaired: false));
    expect(find.text('Pair with Muse Desktop'), findsOneWidget);
  });

  testWidgets('NoteDetailView renders title, markdown content, tags and mode controls', (WidgetTester tester) async {
    final note = Note(
      id: 'test-note-1',
      title: 'Workout Log',
      content: '## Exercises\n* Incline Bench Press\n* Lateral Raises',
      tags: ['gym', 'fitness'],
      favorite: false,
      updatedAt: '2026-10-18T10:00:00.000Z',
    );

    await tester.pumpWidget(
      MaterialApp(
        home: NoteDetailView(note: note),
      ),
    );

    // Verify Title & Tags
    expect(find.text('Workout Log'), findsOneWidget);
    expect(find.text('#gym'), findsOneWidget);
    expect(find.text('#fitness'), findsOneWidget);

    // Verify Read and Edit mode controls
    expect(find.text('Read'), findsOneWidget);
    expect(find.text('Edit'), findsOneWidget);

    // Verify Action buttons
    expect(find.byIcon(Icons.star_outline_rounded), findsOneWidget);
    expect(find.byIcon(Icons.delete_outline_rounded), findsOneWidget);
    expect(find.text('Edit Note'), findsOneWidget);
  });

  testWidgets('TasksTab renders segment controls and date filters', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: TasksTab(),
      ),
    );

    await tester.pump();
    expect(find.byType(TasksTab), findsOneWidget);
    expect(find.textContaining('Tasks'), findsWidgets);
    expect(find.textContaining('Schedule'), findsWidgets);
    expect(find.text('ALL'), findsOneWidget);
  });

  testWidgets('Delete a task -> undo bar gone within ~10s', (WidgetTester tester) async {
    final t = TodoTask(
      id: 't-del-1',
      title: 'Task to be deleted',
      completed: false,
      dueDate: DateFormat('yyyy-MM-dd').format(DateTime.now()),
    );
    await TaskCache.saveTasks([t]);
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: TasksTab()),
      ),
    );

    // Initial load of tasks
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));
    expect(find.text('Task to be deleted'), findsOneWidget);

    // Delete the task via delete button
    final deleteBtn = find.byTooltip('Delete');
    expect(deleteBtn, findsOneWidget);
    await tester.tap(deleteBtn);
    await tester.pump();

    // Verify task is removed from UI and Undo bar appears
    expect(find.text('Task to be deleted'), findsNothing);
    expect(find.text('Task deleted'), findsOneWidget);
    expect(find.text('Undo'), findsOneWidget);

    // Advance timer by 10 seconds to auto-dismiss
    await tester.pump(const Duration(seconds: 10));
    await tester.pump(const Duration(milliseconds: 300));

    // Verify Undo bar is gone within ~10s
    expect(find.text('Undo'), findsNothing);
    expect(find.text('Task deleted'), findsNothing);
  });

  testWidgets('BipChatTab renders status banner and suggestion chips', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: BipChatTab()),
      ),
    );

    await tester.pump();
    expect(find.textContaining('conversation'), findsOneWidget);
    expect(find.text('New chat'), findsOneWidget);
    expect(find.text('What notes do I have?'), findsOneWidget);
  });

  testWidgets('BipChatTab opens conversations drawer and renders search', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: BipChatTab()),
      ),
    );

    await tester.pump();
    final drawerBtn = find.byIcon(Icons.forum_outlined);
    expect(drawerBtn, findsOneWidget);
    await tester.tap(drawerBtn);
    await tester.pumpAndSettle();

    expect(find.text('Conversations'), findsOneWidget);
    expect(find.text('Search chats...'), findsOneWidget);
    expect(find.text('New'), findsOneWidget);
  });

  testWidgets('BipChatScreen renders back button and assistant header', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: BipChatScreen(),
      ),
    );

    await tester.pump();
    expect(find.byIcon(Icons.arrow_back_rounded), findsOneWidget);
    expect(find.textContaining('conversation'), findsOneWidget);
  });
}
