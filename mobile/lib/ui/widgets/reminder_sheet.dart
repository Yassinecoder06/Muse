import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../data/models/task.dart';
import '../../data/services/api_service.dart';
import '../../data/services/app_events.dart';
import '../../data/services/offline_queue.dart';
import '../../data/services/reminder_service.dart';
import '../../data/services/task_cache.dart';
import '../theme/app_theme.dart';

const reminderPresets = <(String, int)>[
  ('At due time', 0),
  ('1 min', 1),
  ('2 min', 2),
  ('5 min', 5),
  ('10 min', 10),
  ('15 min', 15),
  ('30 min', 30),
  ('1 hour', 60),
  ('1 day', 1440),
];

/// Short label for a task's reminder, e.g. "10 min before" or "Tue 7:45 PM".
String? reminderLabel(TodoTask task) {
  if (task.reminderAt == null) return null;
  final minutes = task.reminderMinutesBefore;
  if (minutes == null) return DateFormat('EEE h:mm a').format(task.reminderAt!);
  if (minutes == 0) return 'At due time';
  if (minutes % 1440 == 0) return '${minutes ~/ 1440}d before';
  if (minutes % 60 == 0) return '${minutes ~/ 60}h before';
  return '$minutes min before';
}

/// Lets the user choose when Bip should ring for a task. Returns true if saved.
Future<bool?> showReminderSheet(BuildContext context, TodoTask task) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppTheme.surface,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (_) => _ReminderSheet(task: task),
  );
}

class _ReminderSheet extends StatefulWidget {
  final TodoTask task;
  const _ReminderSheet({required this.task});

  @override
  State<_ReminderSheet> createState() => _ReminderSheetState();
}

class _ReminderSheetState extends State<_ReminderSheet> {
  final _api = ApiService();
  final _customMinutes = TextEditingController();
  TimeOfDay? _dueTime;
  // 'none', a preset's minutes as text, 'minutes' (custom), or 'exact'.
  late String _mode;
  DateTime? _exactAt;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final match = RegExp(r'^(\d{1,2}):(\d{2})').firstMatch(widget.task.dueTime ?? '');
    if (match != null) _dueTime = TimeOfDay(hour: int.parse(match[1]!), minute: int.parse(match[2]!));
    final minutes = widget.task.reminderMinutesBefore;
    if (widget.task.reminderAt == null) {
      _mode = 'none';
    } else if (minutes == null) {
      _mode = 'exact';
      _exactAt = widget.task.reminderAt;
    } else if (reminderPresets.any((p) => p.$2 == minutes)) {
      _mode = '$minutes';
    } else {
      _mode = 'minutes';
      _customMinutes.text = '$minutes';
    }
  }

  @override
  void dispose() {
    _customMinutes.dispose();
    super.dispose();
  }

  String _hhmm(TimeOfDay t) => '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

  Future<void> _pickExact() async {
    final now = DateTime.now();
    final initial = _exactAt ?? widget.task.dueAt ?? now.add(const Duration(minutes: 30));
    final date = await showDatePicker(context: context, initialDate: initial.isBefore(now) ? now : initial, firstDate: DateTime(now.year, now.month, now.day), lastDate: DateTime(now.year + 2));
    if (date == null || !mounted) return;
    final time = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(initial));
    if (time == null) return;
    setState(() => _exactAt = DateTime(date.year, date.month, date.day, time.hour, time.minute));
  }

  Future<void> _save() async {
    setState(() {
      _error = null;
      _saving = true;
    });
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final dueTime = _dueTime != null ? _hhmm(_dueTime!) : null;
      final dueTimeChanged = dueTime != null && !(widget.task.dueTime ?? '').startsWith(dueTime);
      final needsDate = widget.task.dueDate == null && _mode != 'none' && _mode != 'exact';
      int? minutes;
      if (_mode == 'minutes') {
        minutes = int.tryParse(_customMinutes.text.trim());
        if (minutes == null || minutes < 0) throw Exception('Enter how many minutes before.');
      } else if (_mode != 'none' && _mode != 'exact') {
        minutes = int.parse(_mode);
      }
      if (_mode == 'exact') {
        if (_exactAt == null) throw Exception('Pick when Bip should ring.');
        if (_exactAt!.isBefore(DateTime.now())) throw Exception('That time has already passed.');
      }

      if (_mode != 'none') {
        final allowed = await ReminderService.ensureAlarmPermissions();
        if (!allowed) messenger.showSnackBar(const SnackBar(content: Text('Notifications are blocked for Muse, so the alarm cannot ring. Allow them in system settings.')));
      }

      final dateStr = needsDate ? DateFormat('yyyy-MM-dd').format(DateTime.now()) : null;
      try {
        await _api.updateTaskReminder(
          widget.task.id,
          dueDate: dateStr,
          dueTime: dueTimeChanged ? dueTime : null,
          minutesBefore: minutes,
          at: _mode == 'exact' ? _exactAt : null,
          clear: _mode == 'none',
        );
        final cached = await TaskCache.get(widget.task.id);
        if (cached != null) {
          DateTime? remAt = _mode == 'exact' ? _exactAt : null;
          if (_mode == 'none') remAt = null;
          await TaskCache.put(cached.copyWith(
            dueDate: dateStr ?? cached.dueDate,
            dueTime: (dueTimeChanged ? dueTime : null) ?? cached.dueTime,
            reminderMinutesBefore: _mode == 'none' ? null : minutes,
            reminderAt: remAt,
          ));
        }
      } catch (e) {
        if (!OfflineQueue.isNetworkError(e)) rethrow;
        // Offline: save the reminder update to the local queue!
        await OfflineQueue.queueTaskUpdate(
          widget.task,
          dueDate: dateStr,
          dueTime: dueTimeChanged ? dueTime : null,
          reminderMinutesBefore: _mode == 'none' ? null : minutes,
          reminderAt: _mode == 'exact' ? _exactAt : null,
          clearReminder: _mode == 'none',
        );
      }
      AppEvents.notifyDataChanged(); // Tasks tab reloads and schedules the alarm
      navigator.pop(true);
    } catch (e) {
      setState(() {
        _saving = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  ChoiceChip _chip(String label, String value) => ChoiceChip(
        label: Text(label, style: TextStyle(fontSize: 12, color: _mode == value ? Colors.white : AppTheme.textPrimary)),
        selected: _mode == value,
        selectedColor: AppTheme.primary,
        backgroundColor: AppTheme.background,
        showCheckmark: false,
        onSelected: (_) => setState(() => _mode = value),
      );

  @override
  Widget build(BuildContext context) {
    // Scrolls when taller than the screen (small phones, larger text).
    return SingleChildScrollView(
      child: Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom + 20, left: 20, right: 20, top: 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Icon(Icons.alarm_rounded, color: AppTheme.primaryLight),
              const SizedBox(width: 8),
              Expanded(
                child: Text(widget.task.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
              ),
            ],
          ),
          const SizedBox(height: 14),
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(foregroundColor: AppTheme.textPrimary, side: const BorderSide(color: AppTheme.surfaceBorder)),
            icon: const Icon(Icons.access_time_rounded, size: 18, color: AppTheme.accent),
            label: Text(_dueTime != null ? 'Due at ${_dueTime!.format(context)}' : 'Set a due time'),
            onPressed: () async {
              final picked = await showTimePicker(context: context, initialTime: _dueTime ?? TimeOfDay.now());
              if (picked != null) setState(() => _dueTime = picked);
            },
          ),
          const SizedBox(height: 14),
          const Text('Bip rings me…', style: TextStyle(color: AppTheme.textSecondary, fontSize: 13, fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              _chip('No reminder', 'none'),
              for (final (label, minutes) in reminderPresets) _chip(minutes == 0 ? label : '$label before', '$minutes'),
              _chip('Custom minutes…', 'minutes'),
              _chip('Exact time…', 'exact'),
            ],
          ),
          if (_mode == 'minutes') ...[
            const SizedBox(height: 10),
            TextField(
              controller: _customMinutes,
              autofocus: true,
              keyboardType: TextInputType.number,
              style: const TextStyle(color: AppTheme.textPrimary),
              decoration: InputDecoration(
                hintText: 'Minutes before the due time, e.g. 3',
                hintStyle: const TextStyle(color: AppTheme.textSecondary),
                filled: true,
                fillColor: AppTheme.background,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
              ),
            ),
          ],
          if (_mode == 'exact') ...[
            const SizedBox(height: 10),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(foregroundColor: AppTheme.textPrimary, side: const BorderSide(color: AppTheme.surfaceBorder)),
              icon: const Icon(Icons.event_rounded, size: 18, color: AppTheme.primaryLight),
              label: Text(_exactAt != null ? DateFormat('EEE, MMM d · h:mm a').format(_exactAt!) : 'Pick date & time'),
              onPressed: _pickExact,
            ),
          ],
          if (widget.task.dueDate == null && _mode != 'none' && _mode != 'exact')
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text('No due date yet: today will be used.', style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
            ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(_error!, style: const TextStyle(color: Colors.redAccent, fontSize: 12)),
            ),
          const SizedBox(height: 16),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.primary,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 14),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            onPressed: _saving ? null : _save,
            child: Text(_saving ? 'Saving…' : 'Save reminder', style: const TextStyle(fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    ),
    );
  }
}
