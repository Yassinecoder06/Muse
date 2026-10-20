import 'package:flutter/material.dart';
import '../../data/services/api_service.dart';
import '../../data/services/offline_queue.dart';
import '../../data/services/reminder_service.dart';
import '../../data/services/storage_service.dart';
import '../../data/services/tts_service.dart';
import '../theme/app_theme.dart';
import '../widgets/alarm_setup_card.dart';
import 'pairing_screen.dart';

class SettingsTab extends StatefulWidget {
  const SettingsTab({super.key});

  @override
  State<SettingsTab> createState() => _SettingsTabState();
}

class _SettingsTabState extends State<SettingsTab> {
  final StorageService _storage = StorageService();
  final ApiService _api = ApiService();
  final TtsService _tts = TtsService();

  String? _serverUrl;
  String? _deviceName;
  String? _deviceToken;
  bool _isOnline = false;
  bool _checking = true;
  Map<String, dynamic>? _usage;
  bool _remindersOn = false;
  bool _autoReadAloud = true;
  double _speechRate = 0.5;

  final TextEditingController _nameController = TextEditingController();
  bool _nameSaved = false;

  @override
  void initState() {
    super.initState();
    _loadInfo();
    _storage.getUserName().then((name) {
      if (mounted) _nameController.text = name;
    });
    _tts.getAutoReadAloud().then((on) {
      if (mounted) setState(() => _autoReadAloud = on);
    });
    _tts.getSpeechRate().then((rate) {
      if (mounted) setState(() => _speechRate = rate);
    });
    ReminderService.isEnabled().then((on) {
      if (mounted) setState(() => _remindersOn = on);
    });
  }

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _saveUserName() async {
    final name = _nameController.text.trim();
    if (name.isEmpty) return;
    await _storage.setUserName(name);
    if (mounted) {
      setState(() => _nameSaved = true);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Name updated to "$name"')),
      );
      Future.delayed(const Duration(seconds: 2), () {
        if (mounted) setState(() => _nameSaved = false);
      });
    }
  }

  Future<void> _setReminders(bool on) async {
    final enabled = await ReminderService.setEnabled(on);
    if (!mounted) return;
    setState(() => _remindersOn = enabled);
    if (on && !enabled) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Notifications are blocked. Allow them for Muse in system settings.')),
      );
    } else if (enabled) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Reminders on. They update each time your schedule refreshes.')),
      );
    }
  }

  Future<void> _loadInfo() async {
    setState(() => _checking = true);
    final url = await _storage.getServerUrl();
    final name = await _storage.getDeviceName();
    final token = await _storage.getDeviceToken();
    final online = await _api.checkConnection();
    Map<String, dynamic>? usage;
    if (online) {
      try {
        usage = await _api.getUsage();
      } catch (_) {}
    }

    if (mounted) {
      setState(() {
        _serverUrl = url;
        _deviceName = name;
        _deviceToken = token;
        _isOnline = online;
        _usage = usage;
        _checking = false;
      });
    }
  }

  Future<void> _unlink() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.getSurface(ctx),
        title: Text('Unlink Mobile Device?', style: TextStyle(color: AppTheme.getTextPrimary(ctx))),
        content: Text(
          'This will remove the pairing credentials from this phone. You will need to scan a new QR code to reconnect.',
          style: TextStyle(color: AppTheme.getTextSecondary(ctx)),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text('Cancel', style: TextStyle(color: AppTheme.getTextSecondary(ctx))),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.redAccent),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Unlink', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      await _storage.clear();
      if (!mounted) return;
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const PairingScreen()),
        (route) => false,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final tokenSnippet = _deviceToken != null && _deviceToken!.length > 16
        ? '${_deviceToken!.substring(0, 12)}…'
        : _deviceToken ?? '';

    return Scaffold(
      backgroundColor: AppTheme.getBackground(context),
      body: ListView(
        padding: const EdgeInsets.all(16.0),
        children: [
          // App Header
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8.0),
            child: Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [AppTheme.primary, AppTheme.primaryLight],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    borderRadius: BorderRadius.circular(12),
                    boxShadow: [
                      BoxShadow(
                        color: AppTheme.primaryLight.withValues(alpha: 0.35),
                        blurRadius: 12,
                        offset: const Offset(0, 3),
                      ),
                    ],
                  ),
                  child: const Icon(Icons.auto_awesome, color: Colors.white, size: 22),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Muse Settings',
                        style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.getTextPrimary(context)),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'Remote synced with Muse Desktop',
                        style: TextStyle(fontSize: 12, color: AppTheme.getTextSecondary(context)),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),

          // User Name Card matching Web Settings
          Card(
            color: AppTheme.getSurface(context),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
              side: BorderSide(color: AppTheme.getSurfaceBorder(context)),
            ),
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.person_outline_rounded, color: AppTheme.primaryLight, size: 20),
                      const SizedBox(width: 8),
                      Text(
                        'Your Name',
                        style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: AppTheme.getTextPrimary(context)),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Used across your notes, hero greetings, and assistant conversations.',
                    style: TextStyle(fontSize: 12, color: AppTheme.getTextSecondary(context)),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _nameController,
                          style: TextStyle(color: AppTheme.getTextPrimary(context), fontSize: 14),
                          decoration: InputDecoration(
                            hintText: 'e.g. Alex',
                            hintStyle: TextStyle(color: AppTheme.getTextSecondary(context)),
                            filled: true,
                            fillColor: AppTheme.getBackground(context),
                            contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(10),
                              borderSide: BorderSide(color: AppTheme.getSurfaceBorder(context)),
                            ),
                            enabledBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(10),
                              borderSide: BorderSide(color: AppTheme.getSurfaceBorder(context)),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      ElevatedButton(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppTheme.primary,
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                        ),
                        onPressed: _saveUserName,
                        child: Text(_nameSaved ? 'Saved ✓' : 'Save'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),

          // Appearance Card matching Web Settings
          Card(
            color: AppTheme.getSurface(context),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
              side: BorderSide(color: AppTheme.getSurfaceBorder(context)),
            ),
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            AppTheme.isDark ? Icons.dark_mode_outlined : Icons.light_mode_outlined,
                            color: AppTheme.primaryLight,
                            size: 20,
                          ),
                          const SizedBox(width: 10),
                          Text(
                            'Appearance',
                            style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: AppTheme.getTextPrimary(context)),
                          ),
                        ],
                      ),
                      IconButton(
                        icon: Icon(
                          AppTheme.isDark ? Icons.light_mode_rounded : Icons.dark_mode_rounded,
                          color: AppTheme.primaryLight,
                          size: 20,
                        ),
                        tooltip: AppTheme.isDark ? 'Switch to Light' : 'Switch to Dark',
                        onPressed: () {
                          AppTheme.toggleTheme();
                          setState(() {});
                        },
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    AppTheme.isDark ? 'Dark theme active (matching web dark mode)' : 'Light theme active (matching web light mode)',
                    style: TextStyle(fontSize: 12, color: AppTheme.getTextSecondary(context)),
                  ),
                  const SizedBox(height: 10),
                  SizedBox(
                    width: double.infinity,
                    child: SegmentedButton<ThemeMode>(
                      showSelectedIcon: false,
                      style: const ButtonStyle(
                        visualDensity: VisualDensity.compact,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                      segments: const [
                        ButtonSegment(value: ThemeMode.dark, icon: Icon(Icons.dark_mode_rounded, size: 16), label: Text('Dark')),
                        ButtonSegment(value: ThemeMode.light, icon: Icon(Icons.light_mode_rounded, size: 16), label: Text('Light')),
                      ],
                      selected: {AppTheme.themeNotifier.value},
                      onSelectionChanged: (selected) {
                        AppTheme.setTheme(selected.first);
                        setState(() {});
                      },
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),

          // Connection status card
          Card(
            color: AppTheme.getSurface(context),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
              side: BorderSide(color: AppTheme.getSurfaceBorder(context)),
            ),
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: _isOnline ? AppTheme.accent.withValues(alpha: 0.15) : Colors.orange.withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Icon(
                          _isOnline ? Icons.wifi_rounded : Icons.wifi_off_rounded,
                          color: _isOnline ? AppTheme.accent : Colors.orange,
                          size: 20,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              _isOnline ? 'Connected to Muse' : 'Offline / Unreachable',
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.bold,
                                color: _isOnline ? AppTheme.accent : Colors.orange,
                              ),
                            ),
                            Text(
                              _serverUrl ?? 'Not configured',
                              style: TextStyle(fontSize: 12, color: AppTheme.getTextSecondary(context)),
                            ),
                          ],
                        ),
                      ),
                      IconButton(
                        icon: _checking
                            ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                            : Icon(Icons.refresh, size: 20, color: AppTheme.getTextSecondary(context)),
                        onPressed: _loadInfo,
                      ),
                    ],
                  ),
                  const Divider(height: 24),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          const Icon(Icons.smartphone_rounded, size: 17, color: AppTheme.primaryLight),
                          const SizedBox(width: 8),
                          Text('Device: ', style: TextStyle(fontSize: 13, color: AppTheme.getTextSecondary(context))),
                          Expanded(
                            child: Text(
                              _deviceName ?? 'Phone',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: AppTheme.getTextPrimary(context)),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          const Icon(Icons.vpn_key_outlined, size: 16, color: AppTheme.primaryLight),
                          const SizedBox(width: 8),
                          Text('Token: ', style: TextStyle(fontSize: 13, color: AppTheme.getTextSecondary(context))),
                          Expanded(
                            child: Text(
                              tokenSnippet,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(fontSize: 12, fontFamily: 'monospace', color: AppTheme.getTextSecondary(context)),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),

          // Voice & Speech (TTS)
          Card(
            color: AppTheme.getSurface(context),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
              side: BorderSide(color: AppTheme.getSurfaceBorder(context)),
            ),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 6.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SwitchListTile(
                    secondary: const Icon(Icons.volume_up_rounded, color: AppTheme.primaryLight),
                    title: Text('Voice & Speech (TTS)', style: TextStyle(fontSize: 15, color: AppTheme.getTextPrimary(context), fontWeight: FontWeight.w600)),
                    subtitle: Text(
                      'Automatically read Bip responses out loud on mobile',
                      style: TextStyle(fontSize: 12, color: AppTheme.getTextSecondary(context)),
                    ),
                    value: _autoReadAloud,
                    onChanged: (on) async {
                      await _tts.setAutoReadAloud(on);
                      setState(() => _autoReadAloud = on);
                      if (!on) await _tts.stop();
                    },
                  ),
                  Divider(height: 1, color: AppTheme.getSurfaceBorder(context)),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 10.0),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Expanded(
                              child: Text(
                                'Speech Speed',
                                style: TextStyle(fontSize: 14, color: AppTheme.getTextPrimary(context), fontWeight: FontWeight.w500),
                              ),
                            ),
                            Text(
                              _speechRate == 0.4 ? 'Slower (0.8×)' : (_speechRate == 0.6 ? 'Faster (1.2×)' : 'Normal (1.0×)'),
                              style: const TextStyle(fontSize: 12, color: AppTheme.primaryLight, fontWeight: FontWeight.w600),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        SizedBox(
                          width: double.infinity,
                          child: SegmentedButton<double>(
                            showSelectedIcon: false,
                            style: const ButtonStyle(
                              visualDensity: VisualDensity.compact,
                              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                            ),
                            segments: const [
                              ButtonSegment(value: 0.4, label: Text('0.8×')),
                              ButtonSegment(value: 0.5, label: Text('1.0×')),
                              ButtonSegment(value: 0.6, label: Text('1.2×')),
                            ],
                            selected: {_speechRate},
                            onSelectionChanged: (selected) async {
                              final val = selected.first;
                              await _tts.setSpeechRate(val);
                              setState(() => _speechRate = val);
                            },
                          ),
                        ),
                      ],
                    ),
                  ),
                  Divider(height: 1, color: AppTheme.getSurfaceBorder(context)),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            'Hear how Bip sounds on your phone',
                            style: TextStyle(fontSize: 12, color: AppTheme.getTextSecondary(context)),
                          ),
                        ),
                        OutlinedButton.icon(
                          onPressed: () {
                            _tts.speak("Hello! I'm Bip, your proactive Muse AI companion. Voice dictation is ready!");
                          },
                          icon: const Icon(Icons.record_voice_over_rounded, size: 16),
                          label: const Text('Test Voice'),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),

          // Reminders & offline sync
          Card(
            color: AppTheme.getSurface(context),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
              side: BorderSide(color: AppTheme.getSurfaceBorder(context)),
            ),
            child: Column(
              children: [
                SwitchListTile(
                  secondary: const Icon(Icons.notifications_active_outlined, color: AppTheme.primaryLight),
                  title: Text('Reminders & Alarms', style: TextStyle(fontSize: 15, color: AppTheme.getTextPrimary(context), fontWeight: FontWeight.w600)),
                  subtitle: Text(
                    'Ring notifications when tasks are due and before events',
                    style: TextStyle(fontSize: 12, color: AppTheme.getTextSecondary(context)),
                  ),
                  value: _remindersOn,
                  onChanged: _setReminders,
                ),
                Divider(height: 1, color: AppTheme.getSurfaceBorder(context)),
                ValueListenableBuilder<int>(
                  valueListenable: OfflineQueue.pending,
                  builder: (context, pending, _) => ListTile(
                    leading: Icon(
                      pending == 0 ? Icons.cloud_done_outlined : Icons.cloud_upload_outlined,
                      color: pending == 0 ? AppTheme.accent : Colors.amber,
                    ),
                    title: Text('Offline sync queue', style: TextStyle(fontSize: 15, color: AppTheme.getTextPrimary(context), fontWeight: FontWeight.w600)),
                    subtitle: Text(
                      pending == 0 ? 'All changes synced with Muse' : '$pending waiting to sync',
                      style: TextStyle(fontSize: 12, color: AppTheme.getTextSecondary(context)),
                    ),
                    trailing: pending == 0
                        ? null
                        : TextButton(
                            onPressed: () async {
                              final sent = await OfflineQueue.flush(_api);
                              if (!context.mounted) return;
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(content: Text(sent > 0 ? 'Synced $sent item${sent == 1 ? '' : 's'}' : 'Muse is unreachable')),
                              );
                            },
                            child: const Text('Sync now'),
                          ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),

          const AlarmSetupCard(),
          const SizedBox(height: 12),

          // AI Quota card
          if (_usage != null) ...[
            Card(
              color: AppTheme.getSurface(context),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
                side: BorderSide(color: AppTheme.getSurfaceBorder(context)),
              ),
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.smart_toy_outlined, color: AppTheme.primaryLight, size: 20),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'AI Assistant Quota',
                            style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: AppTheme.getTextPrimary(context)),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Provider: ${_usage!['provider'] ?? 'gemini'}',
                      style: TextStyle(fontSize: 13, color: AppTheme.getTextSecondary(context)),
                    ),
                    if (_usage!['requestsToday'] != null) ...[
                      const SizedBox(height: 4),
                      Text(
                        'Requests today: ${_usage!['requestsToday']} / 1,500',
                        style: TextStyle(fontSize: 13, color: AppTheme.getTextPrimary(context)),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
          ],

          // Unlink button
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                foregroundColor: Colors.redAccent,
                side: const BorderSide(color: Colors.redAccent),
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              icon: const Icon(Icons.link_off_rounded),
              label: const Text('Unlink This Phone', style: TextStyle(fontWeight: FontWeight.bold)),
              onPressed: _unlink,
            ),
          ),
        ],
      ),
    );
  }
}
