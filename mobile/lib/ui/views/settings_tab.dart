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

  @override
  void initState() {
    super.initState();
    _loadInfo();
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
        backgroundColor: AppTheme.surface,
        title: const Text('Unlink Mobile Device?', style: TextStyle(color: AppTheme.textPrimary)),
        content: const Text(
          'This will remove the pairing credentials from this phone. You will need to scan a new QR code to reconnect.',
          style: TextStyle(color: AppTheme.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
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
      backgroundColor: AppTheme.background,
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
                    borderRadius: BorderRadius.circular(12),
                    boxShadow: [
                      BoxShadow(
                        color: AppTheme.primaryLight.withValues(alpha: 0.35),
                        blurRadius: 12,
                        offset: const Offset(0, 3),
                      ),
                    ],
                  ),
                  clipBehavior: Clip.antiAlias,
                  child: Image.asset('assets/images/muse_logo.png', fit: BoxFit.cover),
                ),
                const SizedBox(width: 14),
                const Expanded(
                  child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Muse Companion', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
                    SizedBox(height: 2),
                    Text('Encrypted notes & AI partner', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                  ],
                ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),

          // Connection card
          Card(
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
                              style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                            ),
                          ],
                        ),
                      ),
                      IconButton(
                        icon: _checking
                            ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                            : const Icon(Icons.refresh, size: 20, color: AppTheme.textSecondary),
                        onPressed: _loadInfo,
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          // Device info card
          Card(
            child: Column(
              children: [
                ListTile(
                  leading: const Icon(Icons.smartphone_rounded, color: AppTheme.primaryLight),
                  title: const Text('Device Name', style: TextStyle(fontSize: 14, color: AppTheme.textSecondary)),
                  subtitle: Text(_deviceName ?? 'Android Phone', style: const TextStyle(fontSize: 15, color: AppTheme.textPrimary, fontWeight: FontWeight.w600)),
                ),
                const Divider(height: 1, color: AppTheme.surfaceBorder),
                ListTile(
                  leading: const Icon(Icons.vpn_key_outlined, color: AppTheme.primaryLight),
                  title: const Text('Device Token', style: TextStyle(fontSize: 14, color: AppTheme.textSecondary)),
                  subtitle: Text(tokenSnippet, style: const TextStyle(fontSize: 14, color: AppTheme.textPrimary, fontFamily: 'monospace')),
                ),
              ],
            ),
          ),
          // Voice & Speech (TTS)
          Card(
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 6.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SwitchListTile(
                    secondary: const Icon(Icons.volume_up_rounded, color: AppTheme.primaryLight),
                    title: const Text('Voice & Speech (TTS)', style: TextStyle(fontSize: 15, color: AppTheme.textPrimary, fontWeight: FontWeight.w600)),
                    subtitle: const Text(
                      'Automatically read Bip responses out loud on mobile',
                      style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                    ),
                    value: _autoReadAloud,
                    onChanged: (on) async {
                      await _tts.setAutoReadAloud(on);
                      setState(() => _autoReadAloud = on);
                      if (!on) await _tts.stop();
                    },
                  ),
                  const Divider(height: 1, color: AppTheme.surfaceBorder),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 10.0),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Expanded(
                              child: Text(
                                'Speech Speed',
                                style: TextStyle(fontSize: 14, color: AppTheme.textPrimary, fontWeight: FontWeight.w500),
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
                  const Divider(height: 1, color: AppTheme.surfaceBorder),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
                    child: Row(
                      children: [
                        const Expanded(
                          child: Text(
                            'Hear how Bip sounds on your phone',
                            style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                          ),
                        ),
                        OutlinedButton.icon(
                          onPressed: () {
                            _tts.speak("Hello! I'm Bip, your proactive Muse AI companion. Voice text-to-speech is active and working on your phone!");
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
          const SizedBox(height: 16),

          // Reminders & offline sync
          Card(
            child: Column(
              children: [
                SwitchListTile(
                  secondary: const Icon(Icons.notifications_active_outlined, color: AppTheme.primaryLight),
                  title: const Text('Reminders', style: TextStyle(fontSize: 15, color: AppTheme.textPrimary, fontWeight: FontWeight.w600)),
                  subtitle: const Text(
                    'Notify me when timed tasks are due and 10 minutes before events',
                    style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                  ),
                  value: _remindersOn,
                  onChanged: _setReminders,
                ),
                const Divider(height: 1, color: AppTheme.surfaceBorder),
                ValueListenableBuilder<int>(
                  valueListenable: OfflineQueue.pending,
                  builder: (context, pending, _) => ListTile(
                    leading: Icon(
                      pending == 0 ? Icons.cloud_done_outlined : Icons.cloud_upload_outlined,
                      color: pending == 0 ? AppTheme.accent : Colors.amber,
                    ),
                    title: const Text('Offline captures', style: TextStyle(fontSize: 15, color: AppTheme.textPrimary, fontWeight: FontWeight.w600)),
                    subtitle: Text(
                      pending == 0 ? 'Everything is synced' : '$pending waiting to sync with Muse desktop',
                      style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                    ),
                    trailing: pending == 0
                        ? null
                        : TextButton(
                            onPressed: () async {
                              final sent = await OfflineQueue.flush(_api);
                              if (!context.mounted) return;
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(content: Text(sent > 0 ? 'Synced $sent item${sent == 1 ? '' : 's'}' : 'Muse is still unreachable')),
                              );
                            },
                            child: const Text('Sync now'),
                          ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),

          const AlarmSetupCard(),
          const SizedBox(height: 16),

          // AI Quota card
          if (_usage != null) ...[
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Row(
                      children: [
                        Icon(Icons.smart_toy_outlined, color: AppTheme.primaryLight, size: 20),
                        SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'AI Assistant Quota',
                            style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Provider: ${_usage!['provider'] ?? 'gemini'}',
                      style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary),
                    ),
                    if (_usage!['requestsToday'] != null) ...[
                      const SizedBox(height: 4),
                      Text(
                        'Requests today: ${_usage!['requestsToday']} / 1,500',
                        style: const TextStyle(fontSize: 13, color: AppTheme.textPrimary),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
          ],

          // Remote Linking Help Info
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(
                    children: [
                      Icon(Icons.info_outline_rounded, color: AppTheme.primaryLight, size: 20),
                      SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'Connecting Away from Home',
                          style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Text(
                    '• This phone talks to: ${_serverUrl ?? 'not paired'}\n'
                    '• Same Wi-Fi: pair using your computer\'s LAN address (shown in the desktop Pair Phone dialog).\n'
                    '• Over the internet: pair through Tailscale or a Cloudflare Tunnel address instead.\n'
                    '• To switch addresses, unlink below and scan a new code.',
                    style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary, height: 1.5),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),

          // Unlink button
          OutlinedButton.icon(
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
        ],
      ),
    );
  }
}
