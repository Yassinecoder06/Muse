class Note {
  final String id;
  final String title;
  final String content;
  final List<String> tags;
  final bool favorite;
  final String updatedAt;

  Note({
    required this.id,
    required this.title,
    required this.content,
    required this.tags,
    required this.favorite,
    required this.updatedAt,
  });

  factory Note.fromJson(Map<String, dynamic> json) {
    return Note(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? '',
      content: json['content'] as String? ?? '',
      tags: (json['tags'] as List<dynamic>?)?.map((e) => e.toString()).toList() ?? [],
      favorite: json['favorite'] as bool? ?? false,
      updatedAt: json['updated_at'] as String? ?? '',
    );
  }

  String get plainText {
    return content.replaceAll(RegExp(r'<[^>]*>'), ' ').replaceAll(RegExp(r'\s+'), ' ').trim();
  }
}
