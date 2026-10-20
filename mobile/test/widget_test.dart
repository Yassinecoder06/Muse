import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:muse_mobile/main.dart';
import 'package:muse_mobile/data/models/note.dart';
import 'package:muse_mobile/data/services/api_service.dart';
import 'package:muse_mobile/ui/views/note_detail_view.dart';
import 'package:muse_mobile/ui/views/tasks_tab.dart';
import 'package:muse_mobile/ui/views/bip_chat_tab.dart';

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
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({'muse_server_url': 'http://muse.test'});
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
