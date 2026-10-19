import 'dart:async';
import 'package:flutter/material.dart';
import '../../data/services/api_service.dart';
import '../../data/services/app_events.dart';
import '../../data/services/offline_queue.dart';
import '../../data/services/reminder_service.dart';
import '../theme/app_theme.dart';

/// Full-screen Bip alarm, opened from a reminder notification: wiggling Bip,
/// the task, a live countdown to its due time, and Done / Snooze.
class BipAlarmScreen extends StatefulWidget {
  final String taskId;
  final String title;
  final DateTime? due;

  const BipAlarmScreen({super.key, required this.taskId, required this.title, this.due});

  @override
  State<BipAlarmScreen> createState() => _BipAlarmScreenState();
}

class _BipAlarmScreenState extends State<BipAlarmScreen> with SingleTickerProviderStateMixin {
  final _api = ApiService();
  late final AnimationController _wiggle = AnimationController(vsync: this, duration: const Duration(milliseconds: 450))..repeat(reverse: true);
  late final Timer _tick;
  DateTime _now = DateTime.now();
  bool _busy = false;
  bool _snoozed = false;

  @override
  void initState() {
    super.initState();
    _tick = Timer.periodic(const Duration(seconds: 1), (_) => setState(() => _now = DateTime.now()));
  }

  @override
  void dispose() {
    // Leaving the screen silences the alarm, except after Snooze: that just
    // scheduled the re-ring under the same id.
    if (!_snoozed) ReminderService.stopAlarm(widget.taskId);
    _wiggle.dispose();
    _tick.cancel();
    super.dispose();
  }

  static String countdown(DateTime? due, DateTime now) {
    if (due == null) return 'Reminder';
    final diff = due.difference(now);
    if (diff.inSeconds.abs() < 30) return 'Due now';
    final abs = diff.abs();
    final h = abs.inHours;
    final m = abs.inMinutes.remainder(60).toString().padLeft(2, '0');
    final s = abs.inSeconds.remainder(60).toString().padLeft(2, '0');
    final clock = h > 0 ? '$h:$m:$s' : '$m:$s';
    return diff.isNegative ? 'Overdue by $clock' : 'Due in $clock';
  }

  Future<void> _done() async {
    setState(() => _busy = true);
    try {
      if (widget.taskId != ReminderService.testTaskId) {
        await OfflineQueue.setTaskCompleted(_api, widget.taskId, true); // queued if offline
        AppEvents.notifyDataChanged();
      }
    } catch (_) {}
    if (mounted) Navigator.pop(context);
  }

  Future<void> _snooze(int minutes) async {
    setState(() => _busy = true);
    _snoozed = true;
    await ReminderService.snooze(taskId: widget.taskId, title: widget.title, due: widget.due, minutes: minutes);
    // Also on the server so the web alarm follows; fine if offline.
    if (widget.taskId != ReminderService.testTaskId) unawaited(_api.updateTaskReminder(widget.taskId, at: DateTime.now().add(Duration(minutes: minutes))).then((_) {}, onError: (_) {}));
    if (mounted) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final overdue = widget.due != null && _now.isAfter(widget.due!.add(const Duration(seconds: 30)));
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0xFF2A1659), AppTheme.background]),
        ),
        child: SafeArea(
          child: LayoutBuilder(
            builder: (context, box) => SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: ConstrainedBox(
                // Fill the screen when it fits; scroll when it doesn't.
                constraints: BoxConstraints(minHeight: box.maxHeight - 48),
                child: IntrinsicHeight(
                  child: Column(
                    children: [
                const Spacer(),
                AnimatedBuilder(
                  animation: _wiggle,
                  builder: (context, child) => Transform.rotate(
                    angle: (_wiggle.value - 0.5) * 0.25,
                    child: Transform.translate(offset: Offset(0, -6 * _wiggle.value), child: child),
                  ),
                  child: Container(
                    width: 120,
                    height: 120,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: AppTheme.primary,
                      boxShadow: [BoxShadow(color: AppTheme.primaryLight.withValues(alpha: 0.6), blurRadius: 40, spreadRadius: 4)],
                    ),
                    child: const Icon(Icons.smart_toy_rounded, size: 64, color: Colors.white),
                  ),
                ),
                const SizedBox(height: 28),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(999)),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.alarm_rounded, size: 14, color: Color(0xFFC4B5FD)),
                      SizedBox(width: 6),
                      Text('REMINDER', style: TextStyle(color: Color(0xFFC4B5FD), fontWeight: FontWeight.bold, letterSpacing: 1.2, fontSize: 12)),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
                Text(widget.title, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                Text(ReminderService.bipLine(widget.title), textAlign: TextAlign.center, style: const TextStyle(color: AppTheme.textSecondary, fontSize: 15)),
                const SizedBox(height: 24),
                Text(
                  countdown(widget.due, _now),
                  style: TextStyle(
                    color: overdue ? Colors.orangeAccent : const Color(0xFFC4B5FD),
                    fontSize: 34,
                    fontWeight: FontWeight.bold,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
                const Spacer(),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppTheme.accent,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    ),
                    onPressed: _busy ? null : _done,
                    icon: const Icon(Icons.check_rounded),
                    label: const Text('Done', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                  ),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    for (final minutes in [5, 15])
                      Expanded(
                        child: Padding(
                          padding: EdgeInsets.only(right: minutes == 5 ? 10 : 0),
                          child: OutlinedButton(
                            style: OutlinedButton.styleFrom(
                              foregroundColor: Colors.white,
                              side: BorderSide(color: Colors.white.withValues(alpha: 0.3)),
                              padding: const EdgeInsets.symmetric(vertical: 14),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                            ),
                            onPressed: _busy ? null : () => _snooze(minutes),
                            child: Text('Snooze $minutes min'),
                          ),
                        ),
                      ),
                  ],
                ),
                TextButton(
                  onPressed: _busy ? null : () => Navigator.pop(context),
                  child: const Text('Dismiss', style: TextStyle(color: AppTheme.textSecondary)),
                ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
