class TodoTask {
  final String id;
  final String title;
  final bool completed;
  final String? dueDate;
  final String? priority;

  TodoTask({
    required this.id,
    required this.title,
    required this.completed,
    this.dueDate,
    this.priority,
  });

  factory TodoTask.fromJson(Map<String, dynamic> json) {
    return TodoTask(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? '',
      completed: json['completed'] as bool? ?? false,
      dueDate: json['due_date'] as String?,
      priority: json['priority'] as String?,
    );
  }

  TodoTask copyWith({
    String? id,
    String? title,
    bool? completed,
    String? dueDate,
    String? priority,
  }) {
    return TodoTask(
      id: id ?? this.id,
      title: title ?? this.title,
      completed: completed ?? this.completed,
      dueDate: dueDate ?? this.dueDate,
      priority: priority ?? this.priority,
    );
  }
}
