import 'package:flutter/material.dart';
import '../../data/models/chat_message.dart';
import '../../data/services/api_service.dart';
import '../theme/app_theme.dart';

class BipChatTab extends StatefulWidget {
  const BipChatTab({super.key});

  @override
  State<BipChatTab> createState() => _BipChatTabState();
}

class _BipChatTabState extends State<BipChatTab> {
  final ApiService _api = ApiService();
  final TextEditingController _textController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final List<BipMessage> _messages = [];
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _messages.add(
      BipMessage(
        id: 'welcome',
        role: 'assistant',
        text: "Beep boop! 👋 I'm Bip, your Muse AI companion. How can I help you from your phone today?",
        timestamp: DateTime.now(),
      ),
    );
  }

  @override
  void dispose() {
    _textController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _sendMessage(String text) async {
    final query = text.trim();
    if (query.isEmpty || _loading) return;

    _textController.clear();
    setState(() {
      _messages.add(BipMessage(
        id: DateTime.now().microsecondsSinceEpoch.toString(),
        role: 'user',
        text: query,
        timestamp: DateTime.now(),
      ));
      _loading = true;
    });
    _scrollToBottom();

    try {
      final history = _messages
          .where((m) => m.id != 'welcome')
          .map((m) => {'role': m.role, 'content': m.text})
          .toList();

      final res = await _api.sendChatMessage(query, history);
      final replyText = res['response'] as String? ?? 'Bip processed your request.';
      final actionCards = res['actionCards'] as List<dynamic>?;

      setState(() {
        _messages.add(BipMessage(
          id: DateTime.now().microsecondsSinceEpoch.toString(),
          role: 'assistant',
          text: replyText,
          timestamp: DateTime.now(),
          actionCards: actionCards,
        ));
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _messages.add(BipMessage(
          id: DateTime.now().microsecondsSinceEpoch.toString(),
          role: 'assistant',
          text: "I couldn't reach Muse desktop right now: ${e.toString().replaceFirst('Exception: ', '')}",
          timestamp: DateTime.now(),
        ));
        _loading = false;
      });
    }
    _scrollToBottom();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Top status banner
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          color: AppTheme.surface,
          child: Row(
            children: [
              Container(
                width: 8,
                height: 8,
                decoration: const BoxDecoration(
                  color: AppTheme.accent,
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 8),
              const Text(
                'Bip AI Remote Assistant · Ready',
                style: TextStyle(color: AppTheme.textSecondary, fontSize: 12, fontWeight: FontWeight.w500),
              ),
            ],
          ),
        ),

        // Chat messages list
        Expanded(
          child: ListView.builder(
            controller: _scrollController,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
            itemCount: _messages.length,
            itemBuilder: (context, index) {
              final msg = _messages[index];
              final isUser = msg.role == 'user';
              return _buildMessageRow(msg, isUser);
            },
          ),
        ),

        // Quick prompts suggestions
        if (_messages.length <= 2)
          Container(
            height: 40,
            margin: const EdgeInsets.only(bottom: 8),
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              children: [
                _buildPromptChip('What notes do I have?'),
                const SizedBox(width: 8),
                _buildPromptChip('Add task: Finish mobile testing'),
                const SizedBox(width: 8),
                _buildPromptChip('Summarize my week'),
              ],
            ),
          ),

        // Input bar
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: const BoxDecoration(
            color: AppTheme.surface,
            border: Border(top: BorderSide(color: AppTheme.surfaceBorder, width: 1)),
          ),
          child: SafeArea(
            top: false,
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _textController,
                    style: const TextStyle(color: AppTheme.textPrimary, fontSize: 15),
                    textInputAction: TextInputAction.send,
                    onSubmitted: _sendMessage,
                    decoration: InputDecoration(
                      hintText: 'Talk to Bip or dictate…',
                      hintStyle: const TextStyle(color: AppTheme.textSecondary, fontSize: 14),
                      filled: true,
                      fillColor: AppTheme.background,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(24),
                        borderSide: BorderSide.none,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton(
                  icon: const Icon(Icons.mic_none_rounded, color: AppTheme.textSecondary),
                  tooltip: 'Voice Input',
                  onPressed: () {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('Tap and speak or use your keyboard microphone.'),
                        duration: Duration(seconds: 2),
                      ),
                    );
                  },
                ),
                Container(
                  decoration: const BoxDecoration(
                    color: AppTheme.primary,
                    shape: BoxShape.circle,
                  ),
                  child: IconButton(
                    icon: _loading
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                          )
                        : const Icon(Icons.arrow_upward_rounded, color: Colors.white, size: 20),
                    onPressed: () => _sendMessage(_textController.text),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildPromptChip(String text) {
    return ActionChip(
      label: Text(text, style: const TextStyle(fontSize: 12, color: AppTheme.textPrimary)),
      backgroundColor: AppTheme.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: AppTheme.surfaceBorder),
      ),
      onPressed: () => _sendMessage(text),
    );
  }

  Widget _buildMessageRow(BipMessage msg, bool isUser) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16.0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: isUser ? MainAxisAlignment.end : MainAxisAlignment.start,
        children: [
          if (!isUser) ...[
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [AppTheme.primary, AppTheme.primaryLight],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Icon(Icons.smart_toy_rounded, color: Colors.white, size: 18),
            ),
            const SizedBox(width: 10),
          ],
          Flexible(
            child: Column(
              crossAxisAlignment: isUser ? CrossAxisAlignment.end : CrossAxisAlignment.start,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  decoration: BoxDecoration(
                    color: isUser ? AppTheme.primary : AppTheme.surface,
                    borderRadius: BorderRadius.only(
                      topLeft: const Radius.circular(16),
                      topRight: const Radius.circular(16),
                      bottomLeft: Radius.circular(isUser ? 16 : 4),
                      bottomRight: Radius.circular(isUser ? 4 : 16),
                    ),
                    border: isUser ? null : Border.all(color: AppTheme.surfaceBorder),
                  ),
                  child: Text(
                    msg.text,
                    style: TextStyle(
                      color: isUser ? Colors.white : AppTheme.textPrimary,
                      fontSize: 14.5,
                      height: 1.45,
                    ),
                  ),
                ),
                if (msg.actionCards != null && msg.actionCards!.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  for (final card in msg.actionCards!) _buildActionCard(card),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildActionCard(dynamic card) {
    final title = card['title']?.toString() ?? 'Action completed';
    final type = card['type']?.toString() ?? '';
    return Container(
      margin: const EdgeInsets.only(top: 4),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppTheme.accent.withValues(alpha: 0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.check_circle_rounded, color: AppTheme.accent, size: 16),
          const SizedBox(width: 8),
          Flexible(
            child: Text(
              '$type: $title',
              style: const TextStyle(fontSize: 12, color: AppTheme.textPrimary, fontWeight: FontWeight.w500),
            ),
          ),
        ],
      ),
    );
  }
}
