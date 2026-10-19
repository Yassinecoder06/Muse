import 'dart:async';
import 'package:flutter/material.dart';
import 'package:receive_sharing_intent/receive_sharing_intent.dart';
import '../../data/services/api_service.dart';
import '../../data/services/app_events.dart';
import '../../data/services/offline_queue.dart';
import '../theme/app_theme.dart';
import '../widgets/quick_capture_sheet.dart';
import 'bip_chat_tab.dart';
import 'notes_tab.dart';
import 'tasks_tab.dart';
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
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _shareSub?.cancel();
    AppEvents.launchAction.removeListener(_handleLaunchAction);
    super.dispose();
  }

  // Coming back to the app is the natural moment to retry offline captures.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(OfflineQueue.flush(_api));
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
    setState(() => _currentIndex = 1);
    showQuickCapture(context, initialText: text, imagePath: image?.path, imageMime: image?.mimeType);
  }

  void _handleLaunchAction() {
    final action = AppEvents.launchAction.value;
    if (action == null || !mounted) return;
    if (action == 'ask_bip') {
      // BipChatTab starts listening and clears the action.
      setState(() => _currentIndex = 0);
      return;
    }
    AppEvents.launchAction.value = null;
    showQuickCapture(context, startDictation: action == 'voice_note');
  }

  final List<Widget> _tabs = const [
    BipChatTab(),
    NotesTab(),
    TasksTab(),
    SettingsTab(),
  ];

  final List<String> _titles = const [
    'Bip AI Assistant',
    'Notes',
    'Tasks & Schedule',
    'Companion Settings',
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
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
            Text(
              _titles[_currentIndex],
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
            ),
          ],
        ),
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
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _currentIndex,
        onTap: (index) => setState(() => _currentIndex = index),
        items: const [
          BottomNavigationBarItem(
            icon: Icon(Icons.smart_toy_outlined),
            activeIcon: Icon(Icons.smart_toy_rounded),
            label: 'Bip AI',
          ),
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
            icon: Icon(Icons.tune_outlined),
            activeIcon: Icon(Icons.tune_rounded),
            label: 'Settings',
          ),
        ],
      ),
    );
  }
}
