import '../../utils/format_utils.dart';

class Note {
  final String id;
  final String title;
  final String content;
  final List<String> tags;
  final bool favorite;
  final bool archived;
  final String kind;
  final String? summary;
  final String updatedAt;

  Note({
    required this.id,
    required this.title,
    required this.content,
    required this.tags,
    required this.favorite,
    this.archived = false,
    this.kind = 'note',
    this.summary,
    required this.updatedAt,
  });

  factory Note.fromJson(Map<String, dynamic> json) {
    return Note(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? '',
      content: json['content'] as String? ?? '',
      tags: (json['tags'] as List<dynamic>?)?.map((e) => e.toString()).toList() ?? [],
      favorite: json['favorite'] as bool? ?? false,
      archived: json['archived'] as bool? ?? false,
      kind: json['kind'] as String? ?? 'note',
      summary: json['summary'] as String?,
      updatedAt: json['updated_at'] as String? ?? '',
    );
  }

  Note copyWith({
    String? id,
    String? title,
    String? content,
    List<String>? tags,
    bool? favorite,
    bool? archived,
    String? kind,
    String? summary,
    String? updatedAt,
  }) {
    return Note(
      id: id ?? this.id,
      title: title ?? this.title,
      content: content ?? this.content,
      tags: tags ?? this.tags,
      favorite: favorite ?? this.favorite,
      archived: archived ?? this.archived,
      kind: kind ?? this.kind,
      summary: summary ?? this.summary,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'title': title,
      'content': content,
      'tags': tags,
      'favorite': favorite,
      'archived': archived,
      'kind': kind,
      if (summary != null) 'summary': summary,
    };
  }

  String get plainText {
    return FormatUtils.htmlToPlainText(content);
  }

  String get markdownContent {
    return FormatUtils.htmlToMarkdown(content);
  }
}
