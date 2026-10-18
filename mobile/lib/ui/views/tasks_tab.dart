import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../data/models/task.dart';
import '../../data/models/event.dart';
import '../../data/services/api_service.dart';
import '../theme/app_theme.dart';

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
  }

  Future<void> _loadData() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final from = DateTime.now().subtract(const Duration(days: 30));
      final to = DateTime.now().add(const Duration(days: 60));

      final results = await Future.wait([
        _api.fetchTasks(),
        _api.fetchEvents(from: from, to: to),
      ]);

      setState(() {
        _tasks = results[0] as List<TodoTask>;
        _events = results[1] as List<CalendarEvent>;
        _loading = false;
      });
    } catch (e) {
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
      await _api.toggleTaskCompleted(task.id, nextStatus);
    } catch (_) {
      // Revert if error
      setState(() {
        final index = _tasks.indexWhere((t) => t.id == task.id);
        if (index != -1) {
          _tasks[index] = task.copyWith(completed: !nextStatus);
        }
      });
    }
  }

  Future<void> _deleteTask(TodoTask task) async {
    final prev = List<TodoTask>.from(_tasks);
    setState(() {
      _tasks.removeWhere((t) => t.id == task.id);
    });

    try {
      await _api.deleteTask(task.id);
    } catch (e) {
      setState(() => _tasks = prev);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to delete task: $e'), backgroundColor: Colors.redAccent),
        );
      }
    }
  }

  void _showAddTaskSheet() {
    final titleController = TextEditingController();
    String priority = 'medium';
    DateTime dueDate = _selectedDate;
    TimeOfDay? dueTime;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) => Padding(
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
                    final created = await _api.createTask(
                      title: text,
                      dueDate: dateStr,
                      dueTime: timeStr,
                      priority: priority,
                    );
                    setState(() {
                      _tasks.insert(0, created);
                    });
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
    );
  }

  // --- Calendar Event actions ---
  Future<void> _deleteEvent(CalendarEvent event) async {
    final prev = List<CalendarEvent>.from(_events);
    setState(() {
      _events.removeWhere((e) => e.id == event.id);
    });

    try {
      await _api.deleteEvent(event.id);
    } catch (e) {
      setState(() => _events = prev);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to delete event: $e'), backgroundColor: Colors.redAccent),
        );
      }
    }
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
        builder: (ctx, setSheetState) => Padding(
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
        builder: (ctx, setPromptState) => Padding(
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
                            Text(
                              'Tasks (${_tasks.where((t) => !t.completed).length})',
                              style: TextStyle(
                                fontWeight: FontWeight.bold,
                                fontSize: 13,
                                color: _activeSegment == 0 ? Colors.white : AppTheme.textSecondary,
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
                            Text(
                              'Schedule (${_events.length})',
                              style: TextStyle(
                                fontWeight: FontWeight.bold,
                                fontSize: 13,
                                color: _activeSegment == 1 ? Colors.white : AppTheme.textSecondary,
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
                Text(
                  _showAll
                      ? 'All Scheduled Items'
                      : _formatHeaderDate(_selectedDate),
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: AppTheme.textSecondary,
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

    return Dismissible(
      key: Key(task.id),
      direction: DismissDirection.endToStart,
      background: Container(
        margin: const EdgeInsets.only(bottom: 8),
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 20),
        decoration: BoxDecoration(color: Colors.redAccent, borderRadius: BorderRadius.circular(12)),
        child: const Icon(Icons.delete_outline_rounded, color: Colors.white),
      ),
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
          subtitle: (task.dueDate != null || task.dueTime != null)
              ? Row(
                  children: [
                    if (task.dueDate != null) ...[
                      Icon(Icons.calendar_today_rounded, size: 12, color: AppTheme.textSecondary.withValues(alpha: 0.7)),
                      const SizedBox(width: 4),
                      Text(
                        task.dueDate!,
                        style: TextStyle(fontSize: 11, color: AppTheme.textSecondary.withValues(alpha: 0.7)),
                      ),
                      const SizedBox(width: 8),
                    ],
                    if (task.dueTime != null) ...[
                      Icon(Icons.access_time_rounded, size: 12, color: AppTheme.textSecondary.withValues(alpha: 0.7)),
                      const SizedBox(width: 4),
                      Text(
                        task.dueTime!,
                        style: TextStyle(fontSize: 11, color: AppTheme.textSecondary.withValues(alpha: 0.7)),
                      ),
                    ],
                  ],
                )
              : null,
          trailing: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (priorityText.isNotEmpty)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: priorityColor,
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    priorityText,
                    style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: priorityTextColor),
                  ),
                ),
              IconButton(
                icon: const Icon(Icons.close_rounded, size: 18, color: AppTheme.textSecondary),
                onPressed: () => _deleteTask(task),
              ),
            ],
          ),
        ),
      ),
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
                        Row(
                          children: [
                            const Icon(Icons.access_time_rounded, size: 13, color: AppTheme.accent),
                            const SizedBox(width: 4),
                            Text(
                              timeStr,
                              style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary, fontWeight: FontWeight.w500),
                            ),
                            const SizedBox(width: 10),
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
