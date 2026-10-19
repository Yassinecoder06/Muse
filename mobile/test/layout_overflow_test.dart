import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:muse_mobile/data/models/event.dart';
import 'package:muse_mobile/data/models/note.dart';
import 'package:muse_mobile/data/models/task.dart';
import 'package:muse_mobile/data/services/api_service.dart';
import 'package:muse_mobile/data/services/note_cache.dart';
import 'package:muse_mobile/ui/theme/app_theme.dart';
import 'package:muse_mobile/ui/views/bip_alarm_screen.dart';
import 'package:muse_mobile/ui/views/bip_chat_tab.dart';
import 'package:muse_mobile/ui/views/note_detail_view.dart';
import 'package:muse_mobile/ui/views/notes_tab.dart';
import 'package:muse_mobile/ui/views/pairing_screen.dart';
import 'package:muse_mobile/ui/views/settings_tab.dart';
import 'package:muse_mobile/ui/views/tasks_tab.dart';
import 'package:muse_mobile/ui/widgets/quick_capture_sheet.dart';
import 'package:muse_mobile/ui/widgets/reminder_sheet.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Renders every screen with long, realistic data at real phone sizes and
/// larger text, and fails on any layout overflow (the red/yellow stripes).

final today = DateTime.now();
String ymd(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

final longNote = Note(
  id: 'n1',
  title: 'Quarterly planning session with the extended product and design teams',
  content: '<h2>Agenda</h2><p>Discuss <b>roadmap</b> and <a href="https://example.com">specs</a>.</p><ul><li>Item one with a fairly long description that wraps</li><li>Item two</li></ul>',
  tags: ['planning', 'quarterly-review', 'product', 'design', 'longtagname-here'],
  favorite: true,
  kind: 'specialized',
  updatedAt: today.toIso8601String(),
);

class FakeApi extends ApiService {
  FakeApi() : super.base();

  @override
  Future<List<Note>> fetchNotes({String scope = 'all'}) async => [
        longNote,
        Note(id: 'n2', title: 'Groceries', content: 'milk, eggs', tags: [], favorite: false, kind: 'research', updatedAt: today.toIso8601String()),
        Note(id: 'local-1', title: 'Unsynced idea from the train ride home', content: 'draft', tags: ['mobile'], favorite: false, updatedAt: today.toIso8601String()),
      ];

  @override
  Future<List<TodoTask>> fetchTasks({String? dueDate}) async => [
        TodoTask(id: 't1', title: 'Prepare the slides for the Monday all-hands meeting with leadership', completed: false, dueDate: ymd(today), dueTime: '15:30', priority: 'high', reminderAt: today.add(const Duration(hours: 1)), reminderMinutesBefore: 1440),
        TodoTask(id: 't2', title: 'Call mom', completed: false, dueDate: ymd(today), dueTime: '3:00 PM', priority: 'medium', reminderAt: today.add(const Duration(hours: 2))),
        TodoTask(id: 't3', title: 'Pay rent', completed: true, dueDate: ymd(today), priority: 'low'),
      ];

  @override
  Future<List<CalendarEvent>> fetchEvents({DateTime? from, DateTime? to}) async => [
        CalendarEvent(id: 'e1', title: 'Design review with the whole platform engineering team', description: 'Long description', startTime: today.add(const Duration(hours: 3)), endTime: today.add(const Duration(hours: 4)), location: 'Conference room B, 4th floor, west wing'),
        CalendarEvent(id: 'e2', title: 'Holiday', description: '', startTime: today, allDay: true),
      ];

  @override
  Future<Map<String, dynamic>?> fetchLatestMobileSession() async => {
        'id': 's1',
        'messages': [
          {'id': 'm1', 'role': 'user', 'content': 'Add a task to call mom tomorrow at 3pm and remind me 10 minutes before', 'created_at': today.toIso8601String()},
          {
            'id': 'm2',
            'role': 'assistant',
            'content': 'Done! I added **Call mom** for tomorrow at 3:00 PM with a reminder.\n\n- one\n- two',
            'created_at': today.toIso8601String(),
            'tool_calls': [
              {'name': 'create_task'},
              {'name': 'create_calendar_event'},
              {'name': 'permanently_delete_note'},
            ],
            'action_cards': [
              {'type': 'task', 'id': 't9', 'text': 'Call mom about the weekend plans and the birthday dinner', 'priority': 'high', 'dueDate': ymd(today)},
              {'type': 'event', 'id': 'e9', 'title': 'Dinner with family at the new restaurant downtown', 'startTime': today.toIso8601String(), 'location': 'Downtown, Avenue Habib Bourguiba'},
              {'type': 'note', 'id': 'n9', 'title': 'Weekend plans', 'contentSnippet': 'Long snippet text that keeps going and going to test wrapping inside the card'},
              {'type': 'confirm_required', 'title': 'Old meeting notes from last year', 'itemType': 'Note', 'status': 'Permanently delete', 'data': {'token': 'x', 'title': 'Old meeting notes from last year', 'itemType': 'Note', 'status': 'Permanently delete'}},
            ],
          },
        ],
      };

  @override
  Future<bool> checkConnection() async => true;

  @override
  Future<Map<String, dynamic>> getUsage() async => {'provider': 'gemini', 'requestsToday': 1234};

  @override
  Future<Map<String, String>> authHeaders() async => {};

  @override
  Future<String> resolveUrl(String pathOrUrl) async => 'http://muse.test$pathOrUrl';
}

const sizes = {'your phone (392x873)': Size(392, 873), 'small phone (360x740)': Size(360, 740)};
const textScales = [1.0, 1.3];

Future<List<String>> overflowsWhile(WidgetTester tester, Size size, double textScale, Widget screen, {Future<void> Function()? interact}) async {
  final errors = <String>[];
  final previous = FlutterError.onError;
  FlutterError.onError = (details) {
    final text = details.toString();
    if (!text.contains('overflowed')) return previous?.call(details);
    final where = RegExp(r'lib/[\w/]+\.dart:\d+').allMatches(text).map((m) => m[0]).toSet().join(', ');
    errors.add('${details.exceptionAsString().split('\n').first} @ $where');
  };
  tester.view.physicalSize = size * 2.75;
  tester.view.devicePixelRatio = 2.75;
  try {
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.darkTheme,
      builder: (context, child) => MediaQuery(data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)), child: child!),
      home: screen,
    ));
    for (var i = 0; i < 5; i++) {
      await tester.pump(const Duration(milliseconds: 300));
    }
    if (interact != null) {
      await interact();
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 300));
      }
    }
  } finally {
    FlutterError.onError = previous;
    await tester.pumpWidget(const SizedBox());
    tester.view.resetPhysicalSize();
    tester.view.resetDevicePixelRatio();
  }
  return errors;
}

Widget sheetLauncher(void Function(BuildContext) open) => Scaffold(
      body: Builder(builder: (context) => Center(child: ElevatedButton(onPressed: () => open(context), child: const Text('open')))),
    );

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({'muse_server_url': 'http://muse.test', 'muse_device_name': 'Redmi Note 13 Pro+ (sapphire)'});
    NoteCache.resetForTests(null);
    ApiService.testOverride = FakeApi();
    const secure = MethodChannel('plugins.it_nomads.com/flutter_secure_storage');
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(secure, (call) async => call.method == 'read' ? 'muse_dev_0123456789abcdef0123456789' : null);
  });
  tearDown(() => ApiService.testOverride = null);

  final screens = <String, (Widget Function(), Future<void> Function(WidgetTester)?)>{
    'Bip chat': (() => const Scaffold(body: BipChatTab()), null),
    'Notes': (() => const NotesTab(), null),
    'Note (read)': (() => NoteDetailView(note: longNote), null),
    'Note (edit)': (() => NoteDetailView(note: longNote), (t) => t.tap(find.text('Edit').first)),
    'Tasks': (() => const TasksTab(), null),
    'Schedule': (() => const TasksTab(), (t) => t.tap(find.textContaining('Schedule').first)),
    'Settings': (() => const SettingsTab(), null),
    'Pairing': (() => const PairingScreen(), null),
    'Bip alarm': (() => BipAlarmScreen(taskId: 't1', title: 'Prepare the slides for the Monday all-hands meeting', due: today.add(const Duration(minutes: 3))), null),
    'Quick capture': (() => sheetLauncher((c) => showQuickCapture(c, initialText: 'Shared text')), (t) => t.tap(find.text('open'))),
    'Reminder sheet': (
      () => sheetLauncher((c) => showReminderSheet(c, TodoTask(id: 't1', title: 'Prepare the slides for the Monday all-hands meeting', completed: false, dueDate: ymd(today), dueTime: '15:30'))),
      (t) => t.tap(find.text('open')),
    ),
  };

  for (final MapEntry(key: name, value: (build, interact)) in screens.entries) {
    testWidgets('$name has no overflow at phone sizes and larger text', (tester) async {
      final problems = <String>[];
      for (final MapEntry(key: sizeName, value: size) in sizes.entries) {
        for (final scale in textScales) {
          final found = await overflowsWhile(tester, size, scale, build(), interact: interact == null ? null : () => interact(tester));
          problems.addAll(found.map((f) => '$sizeName, text x$scale: $f'));
        }
      }
      expect(problems.toSet().toList(), isEmpty, reason: problems.toSet().join('\n'));
    });
  }
}
