import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:receive_sharing_intent/receive_sharing_intent.dart';
import '../../data/services/api_service.dart';
import '../../data/services/app_events.dart';
import '../../data/services/offline_queue.dart';
import '../../data/services/reminder_service.dart';
import 'bip_alarm_screen.dart';
import '../theme/app_theme.dart';
import '../widgets/bip_companion_button.dart';
import '../widgets/bip_voice_sheet.dart';
import '../widgets/quick_capture_sheet.dart';
import 'notes_tab.dart';
import 'tasks_tab.dart';
import 'music_tab.dart';
import 'insights_tab.dart';
import 'settings_tab.dart';

class MainScaffold extends StatefulWidget {
  const MainScaffold({super.key});

  @override
  State<MainScaffold> createState() => _MainScaffoldState();
}

class _MainScaffoldState extends State<MainScaffold> with WidgetsBindingObserver {
  int _currentIndex = 0;
  final ApiService _api = ApiService();
  StreamSubscription<List<SharedMediaFile>>? _shareSub;
  // While changes are waiting, keep retrying so they sync as soon as the
  // connection comes back, even if the app stays open the whole time.
  Timer? _syncTimer;
  // Opens the Bip alarm in-app when a reminder is due while Muse is open.
  Timer? _alarmTimer;
  String? _alarmScreenFor;
  bool _inForeground = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(OfflineQueue.flush(_api));

    // "Share to Muse" from other apps, whether it launched us or arrived later.
    _shareSub = ReceiveSharingIntent.instance.getMediaStream().listen(_handleShared, onError: (_) {});
    ReceiveSharingIntent.instance.getInitialMedia().then(_handleShared).catchError((_) {});

    AppEvents.launchAction.addListener(_handleLaunchAction);
    WidgetsBinding.instance.addPostFrameCallback((_) => _handleLaunchAction());

    AppEvents.syncMessage.addListener(_showSyncMessage);
    AppEvents.alarmTapped.addListener(_handleAlarmTap);
    ReminderService.planned.addListener(_armInAppAlarm);
    WidgetsBinding.instance.addPostFrameCallback((_) => _handleAlarmTap());
    _syncTimer = Timer.periodic(const Duration(seconds: 30), (timer) {
      if (OfflineQueue.pending.value > 0) unawaited(OfflineQueue.flush(_api));
      // Every 5 minutes, refresh lists so reminders set on the web get
      // scheduled as phone alarms without opening the Tasks tab.
      if (_inForeground && timer.tick % 10 == 0) AppEvents.notifyDataChanged();
    });
  }

  void _armInAppAlarm() {
    _alarmTimer?.cancel();
    final now = DateTime.now();
    final next = ReminderService.planned.value.where((a) => a.at.isAfter(now)).firstOrNull;
    if (next == null) return;
    _alarmTimer = Timer(next.at.difference(now), () {
      if (mounted && _inForeground) _openAlarmScreen(next.taskId, next.title, next.due);
      _armInAppAlarm();
    });
  }

  Future<void> _openAlarmScreen(String taskId, String title, DateTime? due) async {
    if (_alarmScreenFor == taskId) return; // already showing
    _alarmScreenFor = taskId;
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => BipAlarmScreen(taskId: taskId, title: title, due: due)));
    _alarmScreenFor = null;
  }

  // A Bip alarm notification (or its Done / Snooze button) was tapped.
  Future<void> _handleAlarmTap() async {
    final tap = AppEvents.alarmTapped.value;
    if (tap == null || !mounted) return;
    AppEvents.alarmTapped.value = null;
    final Map<String, dynamic> data;
    try {
      data = jsonDecode(tap.payload) as Map<String, dynamic>;
    } catch (_) {
      return;
    }
    final taskId = data['taskId'] as String;
    final title = data['title'] as String? ?? 'Task';
    final dueMs = data['due'] as int?;
    final due = dueMs != null ? DateTime.fromMillisecondsSinceEpoch(dueMs) : null;
    final messenger = ScaffoldMessenger.of(context);

    final isTest = taskId == ReminderService.testTaskId;
    if (tap.action == 'done') {
      await ReminderService.stopAlarm(taskId);
      if (isTest) return;
      try {
        await OfflineQueue.setTaskCompleted(_api, taskId, true);
        AppEvents.notifyDataChanged();
        messenger.showSnackBar(SnackBar(content: Text('Nice! "$title" is done ✓')));
      } catch (_) {}
      return;
    }
    if (tap.action == 'snooze') {
      await ReminderService.snooze(taskId: taskId, title: title, due: due);
      if (!isTest) unawaited(_api.updateTaskReminder(taskId, at: DateTime.now().add(const Duration(minutes: 5))).then((_) {}, onError: (_) {}));
      messenger.showSnackBar(SnackBar(content: Text('Bip will ring again in 5 minutes for "$title"')));
      return;
    }
    await _openAlarmScreen(taskId, title, due);
  }

  void _showSyncMessage() {
    final message = AppEvents.syncMessage.value;
    if (message == null || !mounted) return;
    AppEvents.syncMessage.value = null;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message), duration: const Duration(seconds: 6)));
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _shareSub?.cancel();
    AppEvents.launchAction.removeListener(_handleLaunchAction);
    AppEvents.syncMessage.removeListener(_showSyncMessage);
    AppEvents.alarmTapped.removeListener(_handleAlarmTap);
    ReminderService.planned.removeListener(_armInAppAlarm);
    _alarmTimer?.cancel();
    _syncTimer?.cancel();
    super.dispose();
  }

  // Coming back to the app is the natural moment to retry offline captures.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _inForeground = state == AppLifecycleState.resumed;
    if (state == AppLifecycleState.resumed) {
      unawaited(OfflineQueue.flush(_api));
      AppEvents.notifyDataChanged(); // pick up changes made on desktop meanwhile
      _armInAppAlarm();
    }
  }

  void _handleShared(List<SharedMediaFile> items) {
    if (items.isEmpty || !mounted) return;
    final image = items.where((item) => item.type == SharedMediaType.image).firstOrNull;
    final text = items
        .where((item) => item.type == SharedMediaType.text || item.type == SharedMediaType.url)
        .map((item) => item.path)
        .followedBy(items.map((item) => item.message).whereType<String>())
        .where((value) => value.trim().isNotEmpty)
        .toSet()
        .join('\n\n');
    ReceiveSharingIntent.instance.reset();
    if (image == null && text.isEmpty) return;
    setState(() => _currentIndex = 0);
    showQuickCapture(context, initialText: text, imagePath: image?.path, imageMime: image?.mimeType);
  }

  void _handleLaunchAction() {
    final action = AppEvents.launchAction.value;
    if (action == null || !mounted) return;
    AppEvents.launchAction.value = null;
    if (action == 'ask_bip') {
      BipVoiceSheet.show(context);
      return;
    }
    showQuickCapture(context, startDictation: action == 'voice_note');
  }

  final List<Widget> _tabs = const [
    NotesTab(),
    TasksTab(),
    MusicTab(),
    InsightsTab(),
    SettingsTab(),
  ];

  final List<String> _titles = const [
    'Notes',
    'Schedule',
    'Music Hub',
    'Insights',
    'Settings',
  ];

  @override
  Widget build(BuildContext context) {
    final view = View.of(context);
    final isKeyboardOpen = view.viewInsets.bottom > 0 || MediaQuery.of(context).viewInsets.bottom > 0;
    final isLandscape = MediaQuery.of(context).orientation == Orientation.landscape;

    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        toolbarHeight: (isLandscape && isKeyboardOpen) ? 40 : (isLandscape ? 44 : kToolbarHeight),
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: AppTheme.primary,
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(Icons.auto_awesome, color: Colors.white, size: 16),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                _titles[_currentIndex],
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
              ),
            ),
          ],
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: BipCompanionButton(
              onCustomTap: () => BipVoiceSheet.show(context),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          // Offline captures waiting for the desktop.
          ValueListenableBuilder<int>(
            valueListenable: OfflineQueue.pending,
            builder: (context, pending, _) => pending == 0
                ? const SizedBox.shrink()
                : Material(
                    color: Colors.amber.withValues(alpha: 0.12),
                    child: InkWell(
                      onTap: () => OfflineQueue.flush(_api),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                        child: Row(
                          children: [
                            const Icon(Icons.cloud_upload_outlined, size: 16, color: Colors.amber),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                '$pending change${pending == 1 ? '' : 's'} saved on this phone, waiting for Muse',
                                style: const TextStyle(fontSize: 12, color: Colors.amber),
                              ),
                            ),
                            const Text('Retry', style: TextStyle(fontSize: 12, color: Colors.amber, fontWeight: FontWeight.bold)),
                          ],
                        ),
                      ),
                    ),
                  ),
          ),
          Expanded(
            child: IndexedStack(
              index: _currentIndex,
              children: _tabs,
            ),
          ),
        ],
      ),
      bottomNavigationBar: isKeyboardOpen
          ? null
          : BottomNavigationBar(
              type: BottomNavigationBarType.fixed,
              backgroundColor: AppTheme.surface,
              selectedItemColor: AppTheme.primaryLight,
              unselectedItemColor: AppTheme.textSecondary,
              selectedFontSize: 11,
              unselectedFontSize: 11,
              currentIndex: _currentIndex,
              onTap: (index) => setState(() => _currentIndex = index),
              items: const [
                BottomNavigationBarItem(
                  icon: Icon(Icons.edit_note_outlined),
                  activeIcon: Icon(Icons.edit_note_rounded),
                  label: 'Notes',
                ),
                BottomNavigationBarItem(
                  icon: Icon(Icons.event_note_outlined),
                  activeIcon: Icon(Icons.event_note_rounded),
                  label: 'Schedule',
                ),
                BottomNavigationBarItem(
                  icon: Icon(Icons.headphones_outlined),
                  activeIcon: Icon(Icons.headphones_rounded),
                  label: 'Music',
                ),
                BottomNavigationBarItem(
                  icon: Icon(Icons.insights_outlined),
                  activeIcon: Icon(Icons.insights_rounded),
                  label: 'Insights',
                ),
                BottomNavigationBarItem(
                  icon: Icon(Icons.tune_outlined),
                  activeIcon: Icon(Icons.tune_rounded),
                  label: 'Settings',
                ),
              ],
            ),
    );
  }
}
