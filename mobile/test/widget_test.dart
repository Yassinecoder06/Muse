import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:muse_mobile/main.dart';
import 'package:muse_mobile/data/models/note.dart';
import 'package:muse_mobile/ui/views/note_detail_view.dart';
import 'package:muse_mobile/ui/views/tasks_tab.dart';
import 'package:muse_mobile/ui/views/bip_chat_tab.dart';

void main() {
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
}
