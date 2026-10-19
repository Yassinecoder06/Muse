import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../data/models/task.dart';
import '../../data/models/event.dart';
import '../../data/services/api_service.dart';
import '../../data/services/app_events.dart';
import '../../data/services/offline_queue.dart';
import '../../data/services/reminder_service.dart';
import '../theme/app_theme.dart';
import '../widgets/reminder_sheet.dart';

class TasksTab extends StatefulWidget {
  const TasksTab({super.key});

  @override
  State<TasksTab> createState() => _TasksTabState();
}

class _TasksTabState extends State<TasksTab> {
  final ApiService _api = ApiService();

  // Mode: 0 = Tasks, 1 = Schedule / Events
  int _activeSegment = 0;

  List<TodoTask> _tasks = [];
  List<CalendarEvent> _events = [];
  bool _loading = true;
  String? _error;

  // Selected date filter (null means All / Unscheduled)
  late DateTime _selectedDate;
  bool _showAll = false;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _selectedDate = DateTime(now.year, now.month, now.day);
    _loadData();
    AppEvents.dataChanged.addListener(_onDataChanged);
  }

  @override
  void dispose() {
    AppEvents.dataChanged.removeListener(_onDataChanged);
    super.dispose();
  }

  // Bip added a task or event: refresh quietly, keeping the list on screen.
  void _onDataChanged() => _loadData(silent: true);

  Future<void> _loadData({bool silent = false}) async {
    if (!silent) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }

    try {
      final from = DateTime.now().subtract(const Duration(days: 30));
      final to = DateTime.now().add(const Duration(days: 60));

      final results = await Future.wait([
        _api.fetchTasks(),
        _api.fetchEvents(from: from, to: to),
      ]);

      if (!mounted) return;
      setState(() {
        _tasks = results[0] as List<TodoTask>;
        _events = results[1] as List<CalendarEvent>;
        _loading = false;
      });
      // Reminders always follow the freshest lists (including desktop edits).
      await ReminderService.sync(_tasks, _events);
    } catch (e) {
      if (!mounted || silent) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  // --- Task actions ---
  Future<void> _toggleTask(TodoTask task) async {
    final nextStatus = !task.completed;
    setState(() {
      final index = _tasks.indexWhere((t) => t.id == task.id);
      if (index != -1) {
        _tasks[index] = task.copyWith(completed: nextStatus);
      }
    });

    try {
      // Offline: the tick stays and syncs later.
      await OfflineQueue.setTaskCompleted(_api, task.id, nextStatus);
      unawaited(ReminderService.sync(_tasks, _events));
    } catch (_) {
      // Revert if the server rejected it
      if (!mounted) return;
      setState(() {
        final index = _tasks.indexWhere((t) => t.id == task.id);
        if (index != -1) {
          _tasks[index] = task.copyWith(completed: !nextStatus);
        }
      });
    }
  }

  /// Removes an item from the list right away and only deletes it on the
  /// server once the Undo snackbar has gone without being tapped.
  void _deleteWithUndo({required String label, required VoidCallback removeLocally, required VoidCallback restoreLocally, required Future<void> Function() deleteRemotely}) {
    setState(removeLocally);
    final messenger = ScaffoldMessenger.of(context);
    messenger.hideCurrentSnackBar();
    messenger
        .showSnackBar(SnackBar(
          content: Text('$label deleted'),
          duration: const Duration(seconds: 4),
          action: SnackBarAction(label: 'Undo', onPressed: () {}),
        ))
        .closed
        .then((reason) async {
      if (reason == SnackBarClosedReason.action) {
        if (mounted) setState(restoreLocally);
        return;
      }
      try {
        await deleteRemotely();
        unawaited(ReminderService.sync(_tasks, _events));
      } catch (e) {
        if (!mounted) return;
        setState(restoreLocally);
        messenger.showSnackBar(SnackBar(content: Text('Could not delete: ${e.toString().replaceFirst('Exception: ', '')}'), backgroundColor: Colors.redAccent));
      }
    });
  }

  void _deleteTask(TodoTask task) {
    final index = _tasks.indexWhere((t) => t.id == task.id);
    if (index == -1) return;
    _deleteWithUndo(
      label: 'Task',
      removeLocally: () => _tasks.removeAt(index),
      restoreLocally: () => _tasks.insert(index.clamp(0, _tasks.length), task),
      deleteRemotely: () => _api.deleteTask(task.id),
    );
  }

  void _showAddTaskSheet() {
    final titleController = TextEditingController();
    String priority = 'medium';
    DateTime dueDate = _selectedDate;
    TimeOfDay? dueTime;
    int? remindMinutes; // null = no reminder

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) => SingleChildScrollView(
          child: Padding(
            padding: EdgeInsets.only(
              bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
              left: 20,
              right: 20,
              top: 20,
            ),
            child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'Add New Task',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close, color: AppTheme.textSecondary),
                    onPressed: () => Navigator.pop(ctx),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              TextField(
                controller: titleController,
                autofocus: true,
                style: const TextStyle(color: AppTheme.textPrimary),
                decoration: InputDecoration(
                  hintText: 'What needs to be done?',
                  hintStyle: const TextStyle(color: AppTheme.textSecondary),
                  filled: true,
                  fillColor: AppTheme.background,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                ),
              ),
              const SizedBox(height: 14),

              // Priority selector
              Row(
                children: [
                  const Text('Priority:', style: TextStyle(color: AppTheme.textSecondary, fontSize: 13)),
                  const SizedBox(width: 10),
                  ...['low', 'medium', 'high'].map((p) {
                    final isSel = priority == p;
                    return Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                        label: Text(
                          p.toUpperCase(),
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.bold,
                            color: isSel ? Colors.white : AppTheme.textSecondary,
                          ),
                        ),
                        selected: isSel,
                        selectedColor: p == 'high'
                            ? Colors.redAccent
                            : p == 'medium'
                                ? Colors.amber[700]
                                : Colors.blueGrey,
                        backgroundColor: AppTheme.background,
                        onSelected: (val) {
                          if (val) setSheetState(() => priority = p);
                        },
                      ),
                    );
                  }),
                ],
              ),
              const SizedBox(height: 12),

              // Due Date & Time selector
              Row(
                children: [
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppTheme.textPrimary,
                      side: const BorderSide(color: AppTheme.surfaceBorder),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    icon: const Icon(Icons.calendar_today_rounded, size: 16, color: AppTheme.primaryLight),
                    label: Text(
                      DateFormat('MMM d, yyyy').format(dueDate),
                      style: const TextStyle(fontSize: 13),
                    ),
                    onPressed: () async {
                      final picked = await showDatePicker(
                        context: context,
                        initialDate: dueDate,
                        firstDate: DateTime(2020),
                        lastDate: DateTime(2035),
                      );
                      if (picked != null) {
                        setSheetState(() => dueDate = picked);
                      }
                    },
                  ),
                  const SizedBox(width: 8),
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppTheme.textPrimary,
                      side: const BorderSide(color: AppTheme.surfaceBorder),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    icon: const Icon(Icons.access_time_rounded, size: 16, color: AppTheme.accent),
                    label: Text(
                      dueTime != null ? dueTime!.format(context) : 'Time',
                      style: const TextStyle(fontSize: 13),
                    ),
                    onPressed: () async {
                      final picked = await showTimePicker(
                        context: context,
                        initialTime: dueTime ?? TimeOfDay.now(),
                      );
                      if (picked != null) {
                        setSheetState(() => dueTime = picked);
                      }
                    },
                  ),
                ],
              ),
              const SizedBox(height: 12),

              // Bip reminder
              Row(
                children: [
                  const Icon(Icons.alarm_rounded, size: 18, color: AppTheme.primaryLight),
                  const SizedBox(width: 8),
                  const Text('Remind me', style: TextStyle(color: AppTheme.textSecondary, fontSize: 13)),
                  const SizedBox(width: 12),
                  Expanded(
                    child: DropdownButton<int?>(
                      value: remindMinutes,
                      isExpanded: true,
                      dropdownColor: AppTheme.surface,
                      underline: const SizedBox.shrink(),
                      style: const TextStyle(color: AppTheme.textPrimary, fontSize: 13),
                      items: [
                        const DropdownMenuItem<int?>(value: null, child: Text('No reminder')),
                        for (final (label, minutes) in reminderPresets)
                          DropdownMenuItem<int?>(value: minutes, child: Text(minutes == 0 ? label : '$label before')),
                      ],
                      onChanged: (value) => setSheetState(() => remindMinutes = value),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 18),

              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppTheme.primary,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                onPressed: () async {
                  final text = titleController.text.trim();
                  if (text.isEmpty) return;
                  Navigator.pop(ctx);

                  final dateStr = DateFormat('yyyy-MM-dd').format(dueDate);
                  final timeStr = dueTime != null
                      ? '${dueTime!.hour.toString().padLeft(2, '0')}:${dueTime!.minute.toString().padLeft(2, '0')}'
                      : null;

                  try {
                    // Online: the list refreshes via AppEvents. Offline: queued.
                    if (remindMinutes != null) await ReminderService.ensureAlarmPermissions();
                    final savedNow = await OfflineQueue.createTask(
                      _api,
                      title: text,
                      dueDate: dateStr,
                      dueTime: timeStr,
                      priority: priority,
                      reminderMinutesBefore: remindMinutes,
                    );
                    if (!savedNow && mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Saved on your phone. It will sync when Muse is reachable.')),
                      );
                    }
                  } catch (e) {
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text('Failed to add task: $e'), backgroundColor: Colors.redAccent),
                      );
                    }
                  }
                },
                child: const Text('Add Task', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

  // --- Calendar Event actions ---
  void _deleteEvent(CalendarEvent event) {
    final index = _events.indexWhere((e) => e.id == event.id);
    if (index == -1) return;
    _deleteWithUndo(
      label: 'Event',
      removeLocally: () => _events.removeAt(index),
      restoreLocally: () => _events.insert(index.clamp(0, _events.length), event),
      deleteRemotely: () => _api.deleteEvent(event.id),
    );
  }

  void _showAddEventSheet() {
    final titleCtrl = TextEditingController();
    final locationCtrl = TextEditingController();
    final descCtrl = TextEditingController();
    DateTime eventDate = _selectedDate;
    TimeOfDay startTime = const TimeOfDay(hour: 10, minute: 0);
    int durationMinutes = 60;
    bool allDay = false;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) => SingleChildScrollView(
          child: Padding(
            padding: EdgeInsets.only(
              bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
              left: 20,
              right: 20,
              top: 20,
            ),
            child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'Schedule Event',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close, color: AppTheme.textSecondary),
                    onPressed: () => Navigator.pop(ctx),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              TextField(
                controller: titleCtrl,
                autofocus: true,
                style: const TextStyle(color: AppTheme.textPrimary),
                decoration: InputDecoration(
                  hintText: 'Event Title (e.g. Team Sync)',
                  hintStyle: const TextStyle(color: AppTheme.textSecondary),
                  filled: true,
                  fillColor: AppTheme.background,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: locationCtrl,
                style: const TextStyle(color: AppTheme.textPrimary),
                decoration: InputDecoration(
                  hintText: 'Location or Link (optional)',
                  hintStyle: const TextStyle(color: AppTheme.textSecondary),
                  prefixIcon: const Icon(Icons.place_outlined, color: AppTheme.textSecondary, size: 20),
                  filled: true,
                  fillColor: AppTheme.background,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                ),
              ),
              const SizedBox(height: 12),

              // Date & Time Picker Row
              Row(
                children: [
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppTheme.textPrimary,
                      side: const BorderSide(color: AppTheme.surfaceBorder),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    icon: const Icon(Icons.calendar_today_rounded, size: 16, color: AppTheme.primaryLight),
                    label: Text(DateFormat('MMM d').format(eventDate)),
                    onPressed: () async {
                      final picked = await showDatePicker(
                        context: context,
                        initialDate: eventDate,
                        firstDate: DateTime(2020),
                        lastDate: DateTime(2035),
                      );
                      if (picked != null) {
                        setSheetState(() => eventDate = picked);
                      }
                    },
                  ),
                  const SizedBox(width: 8),
                  if (!allDay)
                    OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppTheme.textPrimary,
                        side: const BorderSide(color: AppTheme.surfaceBorder),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                      icon: const Icon(Icons.access_time_rounded, size: 16, color: AppTheme.accent),
                      label: Text(startTime.format(context)),
                      onPressed: () async {
                        final picked = await showTimePicker(
                          context: context,
                          initialTime: startTime,
                        );
                        if (picked != null) {
                          setSheetState(() => startTime = picked);
                        }
                      },
                    ),
                  const Spacer(),
                  Row(
                    children: [
                      const Text('All Day', style: TextStyle(color: AppTheme.textSecondary, fontSize: 13)),
                      Switch(
                        value: allDay,
                        activeThumbColor: AppTheme.accent,
                        onChanged: (val) => setSheetState(() => allDay = val),
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 16),

              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppTheme.primary,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                onPressed: () async {
                  final title = titleCtrl.text.trim();
                  if (title.isEmpty) return;
                  Navigator.pop(ctx);

                  final start = DateTime(
                    eventDate.year,
                    eventDate.month,
                    eventDate.day,
                    allDay ? 0 : startTime.hour,
                    allDay ? 0 : startTime.minute,
                  );
                  final end = allDay
                      ? DateTime(eventDate.year, eventDate.month, eventDate.day, 23, 59, 59)
                      : start.add(Duration(minutes: durationMinutes));

                  try {
                    final created = await _api.createEvent(
                      title: title,
                      location: locationCtrl.text.trim(),
                      description: descCtrl.text.trim(),
                      startTime: start,
                      endTime: end,
                      allDay: allDay,
                    );
                    setState(() {
                      _events.add(created);
                    });
                  } catch (e) {
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text('Failed to add event: $e'), backgroundColor: Colors.redAccent),
                      );
                    }
                  }
                },
                child: const Text('Save Event', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

  void _showQuickAddAIPrompt() {
    final promptCtrl = TextEditingController();
    bool submitting = false;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setPromptState) => SingleChildScrollView(
          child: Padding(
            padding: EdgeInsets.only(
              bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
              left: 20,
              right: 20,
              top: 20,
            ),
            child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(color: AppTheme.primary, borderRadius: BorderRadius.circular(8)),
                    child: const Icon(Icons.auto_awesome, color: Colors.white, size: 16),
                  ),
                  const SizedBox(width: 10),
                  const Text(
                    'AI Quick Schedule',
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
                  ),
                  const Spacer(),
                  IconButton(
                    icon: const Icon(Icons.close, color: AppTheme.textSecondary),
                    onPressed: () => Navigator.pop(ctx),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              const Text(
                'Type naturally, e.g. "Meeting with Alex tomorrow at 3pm for 45 mins" or "Dentist on Friday morning"',
                style: TextStyle(color: AppTheme.textSecondary, fontSize: 12),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: promptCtrl,
                autofocus: true,
                style: const TextStyle(color: AppTheme.textPrimary),
                decoration: InputDecoration(
                  hintText: 'Describe your event or schedule…',
                  hintStyle: const TextStyle(color: AppTheme.textSecondary),
                  filled: true,
                  fillColor: AppTheme.background,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                ),
                onSubmitted: (_) async {
                  if (promptCtrl.text.trim().isNotEmpty && !submitting) {
                    setPromptState(() => submitting = true);
                    try {
                      final ev = await _api.quickAddEvent(promptCtrl.text.trim());
                      if (ctx.mounted) {
                        Navigator.pop(ctx);
                      }
                      if (mounted) {
                        setState(() => _events.add(ev));
                      }
                    } catch (e) {
                      setPromptState(() => submitting = false);
                      if (mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text('AI parse error: $e'), backgroundColor: Colors.redAccent),
                        );
                      }
                    }
                  }
                },
              ),
              const SizedBox(height: 16),
              ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppTheme.primaryLight,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                icon: submitting
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.bolt_rounded, size: 20),
                label: Text(submitting ? 'Parsing…' : 'Quick Add with AI', style: const TextStyle(fontWeight: FontWeight.bold)),
                onPressed: submitting
                    ? null
                    : () async {
                        final p = promptCtrl.text.trim();
                        if (p.isEmpty) return;
                        setPromptState(() => submitting = true);
                        try {
                          final ev = await _api.quickAddEvent(p);
                          if (ctx.mounted) {
                            Navigator.pop(ctx);
                          }
                          if (mounted) {
                            setState(() => _events.add(ev));
                          }
                        } catch (e) {
                          setPromptState(() => submitting = false);
                          if (mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(content: Text('AI parse error: $e'), backgroundColor: Colors.redAccent),
                            );
                          }
                        }
                      },
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

  // --- Date strip generator (yesterday to +12 days) ---
  List<DateTime> _getDateRange() {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final list = <DateTime>[];
    for (int i = -1; i <= 12; i++) {
      list.add(today.add(Duration(days: i)));
    }
    return list;
  }

  @override
  Widget build(BuildContext context) {
    final dateRange = _getDateRange();
    final selectedIso = DateFormat('yyyy-MM-dd').format(_selectedDate);

    // Filter tasks
    final visibleTasks = _showAll
        ? _tasks
        : _tasks.where((t) => t.dueDate == selectedIso).toList();
    final pendingTasks = visibleTasks.where((t) => !t.completed).toList();
    final completedTasks = visibleTasks.where((t) => t.completed).toList();

    // Filter events
    final visibleEvents = _showAll
        ? _events
        : _events.where((e) {
            final eIso = DateFormat('yyyy-MM-dd').format(e.startTime.toLocal());
            return eIso == selectedIso;
          }).toList();

    return Scaffold(
      backgroundColor: AppTheme.background,
      floatingActionButton: FloatingActionButton(
        onPressed: _activeSegment == 0 ? _showAddTaskSheet : _showAddEventSheet,
        tooltip: _activeSegment == 0 ? 'New Task' : 'New Event',
        child: Icon(_activeSegment == 0 ? Icons.add_task_rounded : Icons.add_rounded),
      ),
      body: Column(
        children: [
          // Segment Switcher (Tasks vs Schedule)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: Container(
              padding: const EdgeInsets.all(4),
              decoration: BoxDecoration(
                color: AppTheme.surface,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: AppTheme.surfaceBorder),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: GestureDetector(
                      onTap: () => setState(() => _activeSegment = 0),
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 200),
                        padding: const EdgeInsets.symmetric(vertical: 10),
                        decoration: BoxDecoration(
                          color: _activeSegment == 0 ? AppTheme.primary : Colors.transparent,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        alignment: Alignment.center,
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              Icons.checklist_rounded,
                              size: 18,
                              color: _activeSegment == 0 ? Colors.white : AppTheme.textSecondary,
                            ),
                            const SizedBox(width: 8),
                            Flexible(
                              child: Text(
                                'Tasks (${_tasks.where((t) => !t.completed).length})',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontWeight: FontWeight.bold,
                                  fontSize: 13,
                                  color: _activeSegment == 0 ? Colors.white : AppTheme.textSecondary,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  Expanded(
                    child: GestureDetector(
                      onTap: () => setState(() => _activeSegment = 1),
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 200),
                        padding: const EdgeInsets.symmetric(vertical: 10),
                        decoration: BoxDecoration(
                          color: _activeSegment == 1 ? AppTheme.primary : Colors.transparent,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        alignment: Alignment.center,
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              Icons.calendar_month_rounded,
                              size: 18,
                              color: _activeSegment == 1 ? Colors.white : AppTheme.textSecondary,
                            ),
                            const SizedBox(width: 8),
                            Flexible(
                              child: Text(
                                'Schedule (${_events.length})',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontWeight: FontWeight.bold,
                                  fontSize: 13,
                                  color: _activeSegment == 1 ? Colors.white : AppTheme.textSecondary,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),

          // Horizontal Date Strip
          SizedBox(
            height: 72,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              children: [
                // "All" filter chip
                GestureDetector(
                  onTap: () => setState(() => _showAll = true),
                  child: Container(
                    width: 58,
                    margin: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
                    decoration: BoxDecoration(
                      color: _showAll ? AppTheme.primary.withValues(alpha: 0.25) : AppTheme.surface,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: _showAll ? AppTheme.primaryLight : AppTheme.surfaceBorder,
                        width: _showAll ? 1.5 : 1,
                      ),
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          Icons.all_inclusive_rounded,
                          size: 18,
                          color: _showAll ? AppTheme.primaryLight : AppTheme.textSecondary,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'ALL',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.bold,
                            color: _showAll ? AppTheme.primaryLight : AppTheme.textSecondary,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),

                // Days
                ...dateRange.map((d) {
                  final now = DateTime.now();
                  final isToday = d.year == now.year && d.month == now.month && d.day == now.day;
                  final isSelected = !_showAll &&
                      d.year == _selectedDate.year &&
                      d.month == _selectedDate.month &&
                      d.day == _selectedDate.day;

                  final dIso = DateFormat('yyyy-MM-dd').format(d);
                  final hasTasks = _tasks.any((t) => t.dueDate == dIso);
                  final hasEvents = _events.any((e) {
                    final eIso = DateFormat('yyyy-MM-dd').format(e.startTime.toLocal());
                    return eIso == dIso;
                  });

                  return GestureDetector(
                    onTap: () {
                      setState(() {
                        _selectedDate = d;
                        _showAll = false;
                      });
                    },
                    child: Container(
                      width: 56,
                      margin: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
                      decoration: BoxDecoration(
                        color: isSelected
                            ? AppTheme.primary
                            : isToday
                                ? AppTheme.primary.withValues(alpha: 0.15)
                                : AppTheme.surface,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: isSelected
                              ? AppTheme.primaryLight
                              : isToday
                                  ? AppTheme.primary.withValues(alpha: 0.4)
                                  : AppTheme.surfaceBorder,
                          width: isSelected ? 1.5 : 1,
                        ),
                      ),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(
                            DateFormat('EEE').format(d).toUpperCase(),
                            style: TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.bold,
                              color: isSelected
                                  ? Colors.white.withValues(alpha: 0.8)
                                  : isToday
                                      ? AppTheme.primaryLight
                                      : AppTheme.textSecondary,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            DateFormat('d').format(d),
                            style: TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.bold,
                              color: isSelected
                                  ? Colors.white
                                  : isToday
                                      ? AppTheme.primaryLight
                                      : AppTheme.textPrimary,
                            ),
                          ),
                          const SizedBox(height: 2),
                          // Activity dots indicator
                          Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              if (hasTasks)
                                Container(
                                  width: 4,
                                  height: 4,
                                  margin: const EdgeInsets.symmetric(horizontal: 1),
                                  decoration: BoxDecoration(
                                    color: isSelected ? Colors.white : AppTheme.accent,
                                    shape: BoxShape.circle,
                                  ),
                                ),
                              if (hasEvents)
                                Container(
                                  width: 4,
                                  height: 4,
                                  margin: const EdgeInsets.symmetric(horizontal: 1),
                                  decoration: BoxDecoration(
                                    color: isSelected ? Colors.white : Colors.amber,
                                    shape: BoxShape.circle,
                                  ),
                                ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  );
                }),
              ],
            ),
          ),

          // Date Header info
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 6),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Text(
                    _showAll
                        ? 'All Scheduled Items'
                        : _formatHeaderDate(_selectedDate),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: AppTheme.textSecondary,
                    ),
                  ),
                ),
                if (_activeSegment == 1)
                  TextButton.icon(
                    onPressed: _showQuickAddAIPrompt,
                    icon: const Icon(Icons.auto_awesome, size: 14, color: AppTheme.primaryLight),
                    label: const Text(
                      'AI Quick Add',
                      style: TextStyle(fontSize: 12, color: AppTheme.primaryLight, fontWeight: FontWeight.bold),
                    ),
                  ),
              ],
            ),
          ),

          // Content body
          Expanded(
            child: RefreshIndicator(
              onRefresh: _loadData,
              color: AppTheme.primaryLight,
              child: _loading
                  ? const Center(child: CircularProgressIndicator(color: AppTheme.primaryLight))
                  : _error != null
                      ? Center(
                          child: Padding(
                            padding: const EdgeInsets.all(24.0),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Icon(Icons.cloud_off_rounded, color: Colors.orangeAccent, size: 48),
                                const SizedBox(height: 12),
                                Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: AppTheme.textSecondary)),
                                const SizedBox(height: 16),
                                ElevatedButton.icon(
                                  onPressed: _loadData,
                                  icon: const Icon(Icons.refresh),
                                  label: const Text('Retry'),
                                ),
                              ],
                            ),
                          ),
                        )
                      : _activeSegment == 0
                          ? _buildTasksView(pendingTasks, completedTasks)
                          : _buildScheduleView(visibleEvents),
            ),
          ),
        ],
      ),
    );
  }

  String _formatHeaderDate(DateTime dt) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final target = DateTime(dt.year, dt.month, dt.day);

    if (target == today) return 'Today · ${DateFormat('EEEE, MMM d').format(dt)}';
    if (target == today.add(const Duration(days: 1))) return 'Tomorrow · ${DateFormat('EEEE, MMM d').format(dt)}';
    if (target == today.subtract(const Duration(days: 1))) return 'Yesterday · ${DateFormat('EEEE, MMM d').format(dt)}';
    return DateFormat('EEEE, MMM d').format(dt);
  }

  Widget _buildTasksView(List<TodoTask> pending, List<TodoTask> completed) {
    if (pending.isEmpty && completed.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.check_circle_outline_rounded, size: 48, color: AppTheme.textSecondary.withValues(alpha: 0.4)),
            const SizedBox(height: 12),
            Text(
              _showAll ? 'No tasks found' : 'No tasks for this day',
              style: const TextStyle(color: AppTheme.textSecondary),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: _showAddTaskSheet,
              icon: const Icon(Icons.add, size: 16),
              label: const Text('Add Task'),
            ),
          ],
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 80),
      children: [
        if (pending.isNotEmpty) ...[
          _buildSectionHeader('TO DO (${pending.length})'),
          const SizedBox(height: 8),
          ...pending.map(_buildTaskTile),
          const SizedBox(height: 16),
        ],
        if (completed.isNotEmpty) ...[
          _buildSectionHeader('COMPLETED (${completed.length})'),
          const SizedBox(height: 8),
          ...completed.map(_buildTaskTile),
        ],
      ],
    );
  }

  Widget _buildScheduleView(List<CalendarEvent> events) {
    if (events.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.event_available_rounded, size: 48, color: AppTheme.textSecondary.withValues(alpha: 0.4)),
            const SizedBox(height: 12),
            Text(
              _showAll ? 'No upcoming events' : 'No events scheduled for this day',
              style: const TextStyle(color: AppTheme.textSecondary),
            ),
            const SizedBox(height: 16),
            Wrap(
              spacing: 8,
              children: [
                ElevatedButton.icon(
                  onPressed: _showAddEventSheet,
                  icon: const Icon(Icons.add, size: 16),
                  label: const Text('New Event'),
                ),
                OutlinedButton.icon(
                  onPressed: _showQuickAddAIPrompt,
                  icon: const Icon(Icons.auto_awesome, size: 16, color: AppTheme.primaryLight),
                  label: const Text('AI Quick Add'),
                ),
              ],
            ),
          ],
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 80),
      itemCount: events.length,
      itemBuilder: (ctx, idx) => _buildEventCard(events[idx]),
    );
  }

  Widget _buildSectionHeader(String title) {
    return Text(
      title,
      style: const TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.bold,
        color: AppTheme.textSecondary,
        letterSpacing: 1,
      ),
    );
  }

  Widget _buildTaskTile(TodoTask task) {
    Color priorityColor = Colors.transparent;
    Color priorityTextColor = Colors.transparent;
    String priorityText = '';

    if (task.priority == 'high') {
      priorityColor = Colors.redAccent.withValues(alpha: 0.15);
      priorityTextColor = Colors.redAccent;
      priorityText = 'HIGH';
    } else if (task.priority == 'medium') {
      priorityColor = Colors.amber.withValues(alpha: 0.15);
      priorityTextColor = Colors.amber[700]!;
      priorityText = 'MED';
    } else if (task.priority == 'low') {
      priorityColor = Colors.blueGrey.withValues(alpha: 0.15);
      priorityTextColor = Colors.blueGrey[300]!;
      priorityText = 'LOW';
    }

    // Swipe right: complete / reopen. Swipe left: delete (with Undo).
    return Dismissible(
      key: Key(task.id),
      background: Container(
        margin: const EdgeInsets.only(bottom: 8),
        alignment: Alignment.centerLeft,
        padding: const EdgeInsets.only(left: 20),
        decoration: BoxDecoration(color: AppTheme.accent, borderRadius: BorderRadius.circular(12)),
        child: Icon(task.completed ? Icons.undo_rounded : Icons.check_rounded, color: Colors.white),
      ),
      secondaryBackground: Container(
        margin: const EdgeInsets.only(bottom: 8),
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 20),
        decoration: BoxDecoration(color: Colors.redAccent, borderRadius: BorderRadius.circular(12)),
        child: const Icon(Icons.delete_outline_rounded, color: Colors.white),
      ),
      confirmDismiss: (direction) async {
        if (direction == DismissDirection.startToEnd) {
          _toggleTask(task);
          return false; // the tile stays; only its state flips
        }
        return true;
      },
      onDismissed: (_) => _deleteTask(task),
      child: Card(
        margin: const EdgeInsets.only(bottom: 8),
        child: ListTile(
          contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
          leading: IconButton(
            icon: Icon(
              task.completed ? Icons.check_circle_rounded : Icons.radio_button_unchecked_rounded,
              color: task.completed ? AppTheme.accent : AppTheme.textSecondary,
              size: 22,
            ),
            onPressed: () => _toggleTask(task),
          ),
          title: Text(
            task.title,
            style: TextStyle(
              color: task.completed ? AppTheme.textSecondary : AppTheme.textPrimary,
              decoration: task.completed ? TextDecoration.lineThrough : null,
              fontSize: 15,
              fontWeight: task.completed ? FontWeight.normal : FontWeight.w500,
            ),
          ),
          // Details wrap onto extra lines instead of squeezing the title.
          subtitle: Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Wrap(
              spacing: 10,
              runSpacing: 4,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                if (task.dueDate != null) _meta(Icons.calendar_today_rounded, task.dueDate!),
                if (task.dueTime != null) _meta(Icons.access_time_rounded, task.dueTime!.length > 5 && task.dueTime![2] == ':' ? task.dueTime!.substring(0, 5) : task.dueTime!),
                if (!task.completed && task.reminderAt != null) _meta(Icons.alarm_on_rounded, reminderLabel(task)!, color: AppTheme.primaryLight),
                if (priorityText.isNotEmpty)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(color: priorityColor, borderRadius: BorderRadius.circular(6)),
                    child: Text(priorityText, style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: priorityTextColor)),
                  ),
              ],
            ),
          ),
          trailing: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (!task.completed)
                IconButton(
                  tooltip: task.reminderAt != null ? 'Change reminder' : 'Add reminder',
                  visualDensity: VisualDensity.compact,
                  icon: Icon(
                    task.reminderAt != null ? Icons.alarm_on_rounded : Icons.alarm_add_rounded,
                    size: 20,
                    color: task.reminderAt != null ? AppTheme.primaryLight : AppTheme.textSecondary,
                  ),
                  onPressed: () => showReminderSheet(context, task),
                ),
              IconButton(
                tooltip: 'Delete',
                visualDensity: VisualDensity.compact,
                icon: const Icon(Icons.close_rounded, size: 18, color: AppTheme.textSecondary),
                onPressed: () => _deleteTask(task),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _meta(IconData icon, String label, {Color? color}) {
    final tint = color ?? AppTheme.textSecondary.withValues(alpha: 0.7);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 12, color: tint),
        const SizedBox(width: 4),
        Flexible(child: Text(label, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 11, color: tint))),
      ],
    );
  }

  Widget _buildEventCard(CalendarEvent event) {
    final start = event.startTime.toLocal();
    final end = event.endTime?.toLocal();

    String timeStr = 'All Day';
    if (!event.allDay) {
      final startFmt = DateFormat('h:mm a').format(start);
      if (end != null) {
        final endFmt = DateFormat('h:mm a').format(end);
        timeStr = '$startFmt - $endFmt';
      } else {
        timeStr = startFmt;
      }
    }

    final dateStr = DateFormat('MMM d, yyyy').format(start);

    return Dismissible(
      key: Key(event.id),
      direction: DismissDirection.endToStart,
      background: Container(
        margin: const EdgeInsets.only(bottom: 10),
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 20),
        decoration: BoxDecoration(color: Colors.redAccent, borderRadius: BorderRadius.circular(12)),
        child: const Icon(Icons.delete_outline_rounded, color: Colors.white),
      ),
      onDismissed: (_) => _deleteEvent(event),
      child: Card(
        margin: const EdgeInsets.only(bottom: 10),
        child: Padding(
          padding: const EdgeInsets.all(14.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 4,
                    height: 38,
                    decoration: BoxDecoration(
                      color: event.allDay ? AppTheme.accent : AppTheme.primaryLight,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          event.title,
                          style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.bold,
                            color: AppTheme.textPrimary,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Wrap(
                          spacing: 10,
                          runSpacing: 2,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Icon(Icons.access_time_rounded, size: 13, color: AppTheme.accent),
                                const SizedBox(width: 4),
                                Flexible(
                                  child: Text(
                                    timeStr,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary, fontWeight: FontWeight.w500),
                                  ),
                                ),
                              ],
                            ),
                            Text(
                              '($dateStr)',
                              style: TextStyle(fontSize: 11, color: AppTheme.textSecondary.withValues(alpha: 0.6)),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.delete_outline_rounded, size: 20, color: AppTheme.textSecondary),
                    onPressed: () => _deleteEvent(event),
                  ),
                ],
              ),
              if (event.location.isNotEmpty) ...[
                const SizedBox(height: 8),
                Row(
                  children: [
                    const SizedBox(width: 16),
                    const Icon(Icons.place_outlined, size: 14, color: AppTheme.textSecondary),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        event.location,
                        style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                      ),
                    ),
                  ],
                ),
              ],
              if (event.description.isNotEmpty) ...[
                const SizedBox(height: 6),
                Padding(
                  padding: const EdgeInsets.only(left: 16),
                  child: Text(
                    event.description,
                    style: TextStyle(fontSize: 12, color: AppTheme.textSecondary.withValues(alpha: 0.8), height: 1.3),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
