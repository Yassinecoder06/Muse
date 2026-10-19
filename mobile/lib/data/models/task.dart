class TodoTask {
  final String id;
  final String title;
  final bool completed;
  final String? dueDate;
  final String? dueTime;
  final String priority;
  final String? noteId;
  // When Bip should ring (server-computed), and the "minutes before" setting
  // it came from (null for an exact-time reminder).
  final DateTime? reminderAt;
  final int? reminderMinutesBefore;

  TodoTask({
    required this.id,
    required this.title,
    required this.completed,
    this.dueDate,
    this.dueTime,
    this.priority = 'medium',
    this.noteId,
    this.reminderAt,
    this.reminderMinutesBefore,
  });

  factory TodoTask.fromJson(Map<String, dynamic> json) {
    return TodoTask(
      id: json['id'] as String? ?? '',
      title: (json['text'] ?? json['title'] ?? '') as String,
      completed: json['completed'] as bool? ?? false,
      dueDate: json['due_date'] as String?,
      dueTime: json['due_time'] as String?,
      priority: (json['priority'] as String?)?.toLowerCase() ?? 'medium',
      noteId: json['note_id'] as String?,
      reminderAt: json['reminder_at'] != null ? DateTime.tryParse(json['reminder_at'].toString())?.toLocal() : null,
      reminderMinutesBefore: (json['reminder_minutes_before'] as num?)?.toInt(),
    );
  }

  /// The due moment in local time (09:00 for date-only tasks).
  DateTime? get dueAt {
    final day = dueDate != null ? DateTime.tryParse(dueDate!) : null;
    if (day == null) return null;
    final match = RegExp(r'^(\d{1,2}):(\d{2})').firstMatch(dueTime ?? '');
    return DateTime(day.year, day.month, day.day, match != null ? int.parse(match[1]!) : 9, match != null ? int.parse(match[2]!) : 0);
  }

  Map<String, dynamic> toJson() {
    return {
      'text': title,
      'completed': completed,
      if (dueDate != null) 'due_date': dueDate,
      if (dueTime != null) 'due_time': dueTime,
      'priority': priority,
      if (noteId != null) 'note_id': noteId,
    };
  }

  TodoTask copyWith({
    String? id,
    String? title,
    bool? completed,
    String? dueDate,
    String? dueTime,
    String? priority,
    String? noteId,
    DateTime? reminderAt,
    int? reminderMinutesBefore,
  }) {
    return TodoTask(
      id: id ?? this.id,
      title: title ?? this.title,
      completed: completed ?? this.completed,
      dueDate: dueDate ?? this.dueDate,
      dueTime: dueTime ?? this.dueTime,
      priority: priority ?? this.priority,
      noteId: noteId ?? this.noteId,
      reminderAt: reminderAt ?? this.reminderAt,
      reminderMinutesBefore: reminderMinutesBefore ?? this.reminderMinutesBefore,
    );
  }
}
