import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:receive_sharing_intent/receive_sharing_intent.dart';
import '../../data/services/api_service.dart';
import '../../data/services/app_events.dart';
import '../../data/services/offline_queue.dart';
import '../../data/services/reminder_service.dart';
import '../../data/services/storage_service.dart';
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
  final StorageService _storage = StorageService();
  StreamSubscription<List<SharedMediaFile>>? _shareSub;
  Timer? _syncTimer;
  Timer? _alarmTimer;
  String? _alarmScreenFor;
  bool _inForeground = true;
  String _userName = 'Explorer';

  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey<ScaffoldState>();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(OfflineQueue.flush(_api));
    _loadUserName();

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
      if (_inForeground && timer.tick % 10 == 0) AppEvents.notifyDataChanged();
    });
  }

  Future<void> _loadUserName() async {
    final name = await _storage.getUserName();
    if (mounted) setState(() => _userName = name);
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
    if (_alarmScreenFor == taskId) return;
    _alarmScreenFor = taskId;
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => BipAlarmScreen(taskId: taskId, title: title, due: due)));
    _alarmScreenFor = null;
  }

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

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _inForeground = state == AppLifecycleState.resumed;
    if (state == AppLifecycleState.resumed) {
      unawaited(OfflineQueue.flush(_api));
      AppEvents.notifyDataChanged();
      _loadUserName();
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

  void _showCollectionsSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppTheme.getSurface(context),
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => FutureBuilder<List<dynamic>>(
        future: _api.fetchNotes(scope: 'all'),
        builder: (ctx, snapshot) {
          final notes = snapshot.data ?? [];
          final allTags = notes.expand((n) => n.tags as List<String>).toSet().toList()..sort();

          return Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      'Collections',
                      style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.getTextPrimary(ctx)),
                    ),
                    IconButton(
                      icon: Icon(Icons.close, color: AppTheme.getTextSecondary(ctx)),
                      onPressed: () => Navigator.pop(ctx),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  'Collections are your existing note tags. Filter your notes by tag.',
                  style: TextStyle(fontSize: 13, color: AppTheme.getTextSecondary(ctx)),
                ),
                const SizedBox(height: 16),
                if (allTags.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 20),
                    child: Center(
                      child: Text(
                        'Add tags to your notes to create collections.',
                        style: TextStyle(color: AppTheme.getTextSecondary(ctx)),
                      ),
                    ),
                  )
                else
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: allTags.map((tag) => ActionChip(
                      label: Text('#$tag'),
                      labelStyle: const TextStyle(fontWeight: FontWeight.w600, color: AppTheme.primaryLight),
                      backgroundColor: AppTheme.getBackground(ctx),
                      side: BorderSide(color: AppTheme.getSurfaceBorder(ctx)),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      onPressed: () {
                        Navigator.pop(ctx);
                        setState(() => _currentIndex = 0);
                        // Notes tab will receive focus
                      },
                    )).toList(),
                  ),
                const SizedBox(height: 16),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _buildWebSidebarDrawer(BuildContext context) {
    final initials = _userName.trim().split(RegExp(r'\s+')).map((p) => p.isNotEmpty ? p[0] : '').join('').toUpperCase();
    final displayInitials = initials.isEmpty ? 'MU' : initials.substring(0, initials.length.clamp(1, 2));

    return Drawer(
      backgroundColor: AppTheme.getSurface(context),
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Drawer Brand Header matching Web Sidebar
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(7),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [AppTheme.primary, AppTheme.primaryLight],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: const Icon(Icons.auto_awesome, color: Colors.white, size: 18),
                  ),
                  const SizedBox(width: 12),
                  Text(
                    'Muse',
                    style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w800,
                      color: AppTheme.getTextPrimary(context),
                      letterSpacing: -0.5,
                    ),
                  ),
                  const Spacer(),
                  IconButton(
                    icon: Icon(Icons.close_rounded, color: AppTheme.getTextSecondary(context), size: 20),
                    onPressed: () => Navigator.pop(context),
                  ),
                ],
              ),
            ),

            // "+ New note" Button matching Web
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
              child: SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.primary,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  onPressed: () {
                    Navigator.pop(context);
                    setState(() => _currentIndex = 0);
                    showQuickCapture(context);
                  },
                  icon: const Icon(Icons.add_rounded, size: 18),
                  label: const Text('New note', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                ),
              ),
            ),

            const SizedBox(height: 8),

            // Sidebar Menu Items matching Web
            Expanded(
              child: ListView(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                children: [
                  // Scope items
                  _buildDrawerNavItem(
                    icon: Icons.description_outlined,
                    label: 'All notes',
                    isActive: _currentIndex == 0,
                    onTap: () {
                      Navigator.pop(context);
                      setState(() => _currentIndex = 0);
                    },
                  ),
                  _buildDrawerNavItem(
                    icon: Icons.star_rounded,
                    label: 'Favorites',
                    iconColor: Colors.amber,
                    isActive: false,
                    onTap: () {
                      Navigator.pop(context);
                      setState(() => _currentIndex = 0);
                    },
                  ),
                  _buildDrawerNavItem(
                    icon: Icons.archive_outlined,
                    label: 'Archive',
                    isActive: false,
                    onTap: () {
                      Navigator.pop(context);
                      setState(() => _currentIndex = 0);
                    },
                  ),
                  _buildDrawerNavItem(
                    icon: Icons.delete_outline_rounded,
                    label: 'Trash',
                    iconColor: Colors.redAccent,
                    isActive: false,
                    onTap: () {
                      Navigator.pop(context);
                      setState(() => _currentIndex = 0);
                    },
                  ),

                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 8),
                    child: Divider(height: 1),
                  ),

                  // Tools
                  _buildDrawerNavItem(
                    icon: Icons.smart_toy_outlined,
                    label: 'Bip AI Assistant',
                    iconColor: const Color(0xFF00E5FF),
                    isActive: false,
                    onTap: () {
                      Navigator.pop(context);
                      BipVoiceSheet.show(context);
                    },
                  ),
                  _buildDrawerNavItem(
                    icon: Icons.calendar_month_outlined,
                    label: 'Schedule & Calendar',
                    isActive: _currentIndex == 1,
                    onTap: () {
                      Navigator.pop(context);
                      setState(() => _currentIndex = 1);
                    },
                  ),
                  _buildDrawerNavItem(
                    icon: Icons.headphones_outlined,
                    label: 'Music Hub',
                    isActive: _currentIndex == 2,
                    onTap: () {
                      Navigator.pop(context);
                      setState(() => _currentIndex = 2);
                    },
                  ),
                  _buildDrawerNavItem(
                    icon: Icons.insights_outlined,
                    label: 'Insights & Stats',
                    isActive: _currentIndex == 3,
                    onTap: () {
                      Navigator.pop(context);
                      setState(() => _currentIndex = 3);
                    },
                  ),
                  _buildDrawerNavItem(
                    icon: Icons.folder_open_outlined,
                    label: 'Collections',
                    isActive: false,
                    onTap: () {
                      Navigator.pop(context);
                      _showCollectionsSheet(context);
                    },
                  ),
                  _buildDrawerNavItem(
                    icon: Icons.tune_outlined,
                    label: 'Settings',
                    isActive: _currentIndex == 4,
                    onTap: () {
                      Navigator.pop(context);
                      setState(() => _currentIndex = 4);
                    },
                  ),
                ],
              ),
            ),

            // Sidebar Footer: User Profile Block matching Web
            Padding(
              padding: const EdgeInsets.all(16),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                decoration: BoxDecoration(
                  color: AppTheme.getBackground(context),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppTheme.getSurfaceBorder(context)),
                ),
                child: Row(
                  children: [
                    CircleAvatar(
                      radius: 16,
                      backgroundColor: AppTheme.primary,
                      child: Text(
                        displayInitials,
                        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.white),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _userName,
                            style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.bold,
                              color: AppTheme.getTextPrimary(context),
                            ),
                          ),
                          Text(
                            'Connected to Muse',
                            style: TextStyle(fontSize: 11, color: AppTheme.getTextSecondary(context)),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      icon: Icon(
                        AppTheme.isDark ? Icons.light_mode_rounded : Icons.dark_mode_rounded,
                        size: 18,
                        color: AppTheme.getTextSecondary(context),
                      ),
                      onPressed: () => AppTheme.toggleTheme(),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDrawerNavItem({
    required IconData icon,
    required String label,
    required bool isActive,
    required VoidCallback onTap,
    Color? iconColor,
  }) {
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 2),
      decoration: BoxDecoration(
        color: isActive ? AppTheme.primary.withValues(alpha: 0.15) : Colors.transparent,
        borderRadius: BorderRadius.circular(10),
      ),
      child: ListTile(
        dense: true,
        leading: Icon(
          icon,
          size: 19,
          color: isActive ? AppTheme.primaryLight : (iconColor ?? AppTheme.getTextSecondary(context)),
        ),
        title: Text(
          label,
          style: TextStyle(
            fontSize: 13.5,
            fontWeight: isActive ? FontWeight.bold : FontWeight.w500,
            color: isActive ? AppTheme.primaryLight : AppTheme.getTextPrimary(context),
          ),
        ),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        onTap: onTap,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final view = View.of(context);
    final isKeyboardOpen = view.viewInsets.bottom > 0 || MediaQuery.of(context).viewInsets.bottom > 0;
    final isLandscape = MediaQuery.of(context).orientation == Orientation.landscape;

    return Scaffold(
      key: _scaffoldKey,
      backgroundColor: AppTheme.getBackground(context),
      drawer: _buildWebSidebarDrawer(context),
      appBar: AppBar(
        toolbarHeight: (isLandscape && isKeyboardOpen) ? 40 : (isLandscape ? 44 : kToolbarHeight),
        backgroundColor: AppTheme.getSurface(context),
        leading: IconButton(
          icon: Icon(Icons.view_sidebar_outlined, color: AppTheme.getTextPrimary(context), size: 21),
          tooltip: 'Sidebar Navigation',
          onPressed: () => _scaffoldKey.currentState?.openDrawer(),
        ),
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(5),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [AppTheme.primary, AppTheme.primaryLight],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(Icons.auto_awesome, color: Colors.white, size: 14),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                _titles[_currentIndex],
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 17,
                  color: AppTheme.getTextPrimary(context),
                ),
              ),
            ),
          ],
        ),
        actions: [
          // Theme Toggle Button matching web topbar
          IconButton(
            icon: Icon(
              AppTheme.isDark ? Icons.light_mode_outlined : Icons.dark_mode_outlined,
              color: AppTheme.getTextSecondary(context),
              size: 20,
            ),
            tooltip: AppTheme.isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode',
            onPressed: () => AppTheme.toggleTheme(),
          ),
          // Bip Mascot Companion Voice Dictation Button
          Padding(
            padding: const EdgeInsets.only(right: 8, left: 4),
            child: BipCompanionButton(
              onCustomTap: () => BipVoiceSheet.show(context),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          // Offline captures banner waiting for desktop sync
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
                                '$pending change${pending == 1 ? '' : 's'} saved locally, waiting for Muse',
                                style: const TextStyle(fontSize: 12, color: Colors.amber),
                              ),
                            ),
                            const Text('Sync Now', style: TextStyle(fontSize: 12, color: Colors.amber, fontWeight: FontWeight.bold)),
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
              backgroundColor: AppTheme.getSurface(context),
              selectedItemColor: AppTheme.primaryLight,
              unselectedItemColor: AppTheme.getTextSecondary(context),
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
