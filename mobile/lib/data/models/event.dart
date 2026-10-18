class CalendarEvent {
  final String id;
  final String title;
  final String description;
  final DateTime startTime;
  final DateTime? endTime;
  final bool allDay;
  final String location;
  final String? noteId;

  CalendarEvent({
    required this.id,
    required this.title,
    required this.description,
    required this.startTime,
    this.endTime,
    this.allDay = false,
    this.location = '',
    this.noteId,
  });

  factory CalendarEvent.fromJson(Map<String, dynamic> json) {
    return CalendarEvent(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? 'Untitled Event',
      description: json['description'] as String? ?? '',
      startTime: DateTime.tryParse(json['start_time'] as String? ?? '') ?? DateTime.now(),
      endTime: json['end_time'] != null ? DateTime.tryParse(json['end_time'] as String) : null,
      allDay: json['all_day'] as bool? ?? false,
      location: json['location'] as String? ?? '',
      noteId: json['note_id'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'title': title,
      'description': description,
      'start_time': startTime.toIso8601String(),
      if (endTime != null) 'end_time': endTime!.toIso8601String(),
      'all_day': allDay,
      'location': location,
      if (noteId != null) 'note_id': noteId,
    };
  }
}
