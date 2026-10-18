class BipMessage {
  final String id;
  final String role; // 'user' | 'assistant'
  final String text;
  final DateTime timestamp;
  final List<dynamic>? actionCards;
  final bool isThinking;

  BipMessage({
    required this.id,
    required this.role,
    required this.text,
    required this.timestamp,
    this.actionCards,
    this.isThinking = false,
  });

  factory BipMessage.fromJson(Map<String, dynamic> json) {
    return BipMessage(
      id: json['id'] as String? ?? 'msg_${DateTime.now().millisecondsSinceEpoch}',
      role: json['role'] as String? ?? 'assistant',
      text: json['content'] as String? ?? json['text'] as String? ?? '',
      timestamp: json['timestamp'] != null
          ? DateTime.tryParse(json['timestamp'].toString()) ?? DateTime.now()
          : DateTime.now(),
      actionCards: json['actionCards'] as List<dynamic>?,
    );
  }
}
