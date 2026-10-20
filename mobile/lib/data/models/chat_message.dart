class BipMessage {
  final String id;
  final String role; // 'user' | 'assistant'
  final String text;
  final DateTime timestamp;
  final List<dynamic>? actionCards;
  final List<dynamic>? toolCalls;
  final bool isThinking;
  // Loaded from an earlier session: its confirmation tokens have likely
  // expired or been used, so cards render read-only.
  final bool fromHistory;

  BipMessage({
    required this.id,
    required this.role,
    required this.text,
    required this.timestamp,
    this.actionCards,
    this.toolCalls,
    this.isThinking = false,
    this.fromHistory = false,
  });

  /// A message row from GET /api/chat/sessions/:id.
  factory BipMessage.fromSession(Map<String, dynamic> json) {
    return BipMessage(
      id: json['id']?.toString() ?? 'msg_${DateTime.now().microsecondsSinceEpoch}',
      role: json['role'] as String? ?? 'assistant',
      text: json['content'] as String? ?? json['text'] as String? ?? json['reply'] as String? ?? '',
      timestamp: DateTime.tryParse(json['created_at']?.toString() ?? '') ?? DateTime.now(),
      actionCards: (json['action_cards'] ?? json['actionCards']) as List<dynamic>?,
      toolCalls: (json['tool_calls'] ?? json['toolCalls']) as List<dynamic>?,
      fromHistory: true,
    );
  }

  factory BipMessage.fromJson(Map<String, dynamic> json) {
    return BipMessage(
      id: json['id'] as String? ?? 'msg_${DateTime.now().millisecondsSinceEpoch}',
      role: json['role'] as String? ?? 'assistant',
      text: json['content'] as String? ?? json['text'] as String? ?? json['reply'] as String? ?? '',
      timestamp: json['timestamp'] != null
          ? DateTime.tryParse(json['timestamp'].toString()) ?? DateTime.now()
          : (json['created_at'] != null ? DateTime.tryParse(json['created_at'].toString()) ?? DateTime.now() : DateTime.now()),
      actionCards: (json['actionCards'] ?? json['action_cards']) as List<dynamic>?,
      toolCalls: (json['toolCalls'] ?? json['tool_calls']) as List<dynamic>?,
    );
  }
}
