import 'package:flutter/material.dart';
import '../../data/services/alarm_setup.dart';
import '../../data/services/reminder_service.dart';
import '../theme/app_theme.dart';

/// Checklist of what lets Bip's alarms ring on this phone, each with a button
/// that opens the right system (or Xiaomi) settings page, plus a test alarm.
class AlarmSetupCard extends StatefulWidget {
  const AlarmSetupCard({super.key});

  @override
  State<AlarmSetupCard> createState() => _AlarmSetupCardState();
}

class _AlarmSetupCardState extends State<AlarmSetupCard> with WidgetsBindingObserver {
  AlarmStatus? _status;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _refresh();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  // Back from a settings page: show the new state.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refresh();
  }

  Future<void> _refresh() async {
    final status = await AlarmSetup.check();
    if (mounted) setState(() => _status = status);
  }

  Widget _row({required String title, required String subtitle, bool? ok, required String action, required Future<void> Function() onFix}) {
    final icon = ok == null ? Icons.help_outline_rounded : (ok ? Icons.check_circle_rounded : Icons.error_rounded);
    final color = ok == null ? AppTheme.textSecondary : (ok ? AppTheme.accent : Colors.orangeAccent);
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16),
      leading: Icon(icon, color: color),
      title: Text(title, style: const TextStyle(fontSize: 14, color: AppTheme.textPrimary, fontWeight: FontWeight.w600)),
      subtitle: Text(subtitle, style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
      trailing: ok == true ? null : TextButton(onPressed: onFix, child: Text(action)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final s = _status;
    return Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
            child: Row(
              children: [
                const Icon(Icons.alarm_rounded, color: AppTheme.primaryLight, size: 20),
                const SizedBox(width: 8),
                const Expanded(
                  child: Text('Alarm setup', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
                ),
                if (s != null)
                  Text(
                    s.ready ? 'Ready' : 'Needs attention',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: s.ready ? AppTheme.accent : Colors.orangeAccent),
                  ),
              ],
            ),
          ),
          const Padding(
            padding: EdgeInsets.fromLTRB(16, 0, 16, 4),
            child: Text(
              'For Bip to ring on time, even with Muse closed or the phone locked:',
              style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
            ),
          ),
          _row(title: 'Notifications', subtitle: 'Allowed to alert you', ok: s?.notifications, action: 'Allow', onFix: AlarmSetup.openNotificationSettings),
          _row(title: 'Exact alarms', subtitle: 'Ring at the exact minute, not up to an hour late', ok: s?.exactAlarms, action: 'Allow', onFix: AlarmSetup.openExactAlarmSettings),
          _row(title: 'Full-screen alerts', subtitle: 'Show Bip over the lock screen', ok: s?.fullScreen, action: 'Allow', onFix: AlarmSetup.openFullScreenSettings),
          _row(title: 'No battery restrictions', subtitle: 'So the system does not delay or skip alarms', ok: s?.battery, action: 'Fix', onFix: AlarmSetup.openBatterySettings),
          if (s?.xiaomi == true) ...[
            const Divider(height: 1, color: AppTheme.surfaceBorder),
            _row(
              title: 'Autostart (Xiaomi)',
              subtitle: 'HyperOS blocks alarms of closed apps unless Autostart is on. Turn it on for Muse.',
              action: 'Open',
              onFix: AlarmSetup.openXiaomiAutostart,
            ),
            _row(
              title: 'Lock screen & pop-ups (Xiaomi)',
              subtitle: 'In "Other permissions", allow "Show on Lock screen" and "Display pop-up windows while running in the background".',
              action: 'Open',
              onFix: AlarmSetup.openXiaomiPermissions,
            ),
          ],
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 14),
            child: OutlinedButton.icon(
              style: OutlinedButton.styleFrom(foregroundColor: AppTheme.primaryLight, side: const BorderSide(color: AppTheme.surfaceBorder)),
              icon: const Icon(Icons.notifications_active_outlined, size: 18),
              label: const Text('Test alarm (rings in 10 seconds)'),
              onPressed: () async {
                await ReminderService.ensureAlarmPermissions();
                await ReminderService.testAlarm();
                if (!context.mounted) return;
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Bip will ring in 10 seconds. Lock your phone to test the lock screen too.')),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
