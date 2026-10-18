class TodoTask {
  final String id;
  final String title;
  final bool completed;
  final String? dueDate;
  final String? dueTime;
  final String priority;
  final String? noteId;

  TodoTask({
    required this.id,
    required this.title,
    required this.completed,
    this.dueDate,
    this.dueTime,
    this.priority = 'medium',
    this.noteId,
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
    );
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
  }) {
    return TodoTask(
      id: id ?? this.id,
      title: title ?? this.title,
      completed: completed ?? this.completed,
      dueDate: dueDate ?? this.dueDate,
      dueTime: dueTime ?? this.dueTime,
      priority: priority ?? this.priority,
      noteId: noteId ?? this.noteId,
    );
  }
}
