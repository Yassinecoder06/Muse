import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:intl/intl.dart';
import '../../data/models/chat_message.dart';
import '../../data/services/api_service.dart';
import '../../data/services/voice_service.dart';
import '../theme/app_theme.dart';

class BipChatTab extends StatefulWidget {
  const BipChatTab({super.key});

  @override
  State<BipChatTab> createState() => _BipChatTabState();
}

class _BipChatTabState extends State<BipChatTab> {
  final ApiService _api = ApiService();
  final VoiceService _voice = VoiceService();
  final TextEditingController _textController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final List<BipMessage> _messages = [];
  bool _loading = false;
  bool _isListening = false;

  final List<String> _suggestions = [
    'What notes do I have?',
    'Summarize my workout split',
    'Add task: Review proposal tomorrow',
    'What is scheduled on my calendar?',
  ];

  @override
  void initState() {
    super.initState();
    _messages.add(
      BipMessage(
        id: 'welcome',
        role: 'assistant',
        text: "Beep boop! 🤖✨ I'm Bip, your proactive Muse AI companion.\n\nI can search your notes, manage your tasks, schedule calendar events, and answer questions about your space.",
        timestamp: DateTime.now(),
      ),
    );
  }

  String _initialVoiceText = '';

  @override
  void dispose() {
    _voice.cancelListening();
    _textController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _toggleListening() async {
    if (_isListening) {
      await _voice.stopListening();
      setState(() => _isListening = false);
      return;
    }

    try {
      final available = await _voice.initialize(
        onError: (err) {
          if (mounted) {
            setState(() => _isListening = false);
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text('Speech error: $err'),
                backgroundColor: Colors.redAccent,
              ),
            );
          }
        },
        onStatus: (status) {
          if (status == 'done' || status == 'notListening') {
            if (mounted && _isListening) {
              setState(() => _isListening = false);
            }
          }
        },
      );

      if (!available) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Microphone access is unavailable or denied. Please grant permission in App Settings.'),
              backgroundColor: Colors.redAccent,
            ),
          );
        }
        return;
      }

      _initialVoiceText = _textController.text.trim();
      setState(() => _isListening = true);

      await _voice.startListening(
        onResult: (words, isFinal) {
          if (mounted) {
            setState(() {
              if (_initialVoiceText.isEmpty) {
                _textController.text = words;
              } else {
                _textController.text = '$_initialVoiceText $words';
              }
              _textController.selection = TextSelection.fromPosition(
                TextPosition(offset: _textController.text.length),
              );
              if (isFinal) {
                _isListening = false;
              }
            });
          }
        },
      );
    } catch (e) {
      if (mounted) {
        setState(() => _isListening = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Voice dictation error: $e'),
            backgroundColor: Colors.redAccent,
          ),
        );
      }
    }
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
      final replyText = (res['reply'] ?? res['response'] ?? 'Bip processed your request.').toString();
      final actionCards = res['actionCards'] as List<dynamic>?;
      final toolCalls = res['toolCalls'] as List<dynamic>?;

      setState(() {
        _messages.add(BipMessage(
          id: DateTime.now().microsecondsSinceEpoch.toString(),
          role: 'assistant',
          text: replyText,
          timestamp: DateTime.now(),
          actionCards: actionCards,
          toolCalls: toolCalls,
        ));
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _messages.add(BipMessage(
          id: DateTime.now().microsecondsSinceEpoch.toString(),
          role: 'assistant',
          text: "I couldn't reach Muse desktop right now: ${e.toString().replaceFirst('Exception: ', '')}\n\nPlease verify that your phone and computer are on the same Wi-Fi network.",
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
                style: TextStyle(
                  fontSize: 12,
                  color: AppTheme.textSecondary,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const Spacer(),
              const Icon(Icons.bolt_rounded, size: 16, color: AppTheme.accent),
              const SizedBox(width: 4),
              const Text(
                'Autonomous Tools',
                style: TextStyle(fontSize: 11, color: AppTheme.accent, fontWeight: FontWeight.bold),
              ),
            ],
          ),
        ),

        // Messages list
        Expanded(
          child: ListView.builder(
            controller: _scrollController,
            padding: const EdgeInsets.all(16),
            itemCount: _messages.length + (_loading ? 1 : 0),
            itemBuilder: (context, index) {
              if (index == _messages.length && _loading) {
                return _buildThinkingBubble();
              }
              final message = _messages[index];
              return _buildMessageItem(message);
            },
          ),
        ),

        // Quick suggestions strip
        if (!_loading)
          SizedBox(
            height: 38,
            child: ListView.builder(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              itemCount: _suggestions.length,
              itemBuilder: (context, index) {
                final text = _suggestions[index];
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ActionChip(
                    label: Text(text, style: const TextStyle(fontSize: 12, color: AppTheme.textPrimary)),
                    backgroundColor: AppTheme.surface,
                    side: const BorderSide(color: AppTheme.surfaceBorder),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    onPressed: () => _sendMessage(text),
                  ),
                );
              },
            ),
          ),
        const SizedBox(height: 6),

        if (_isListening)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            margin: const EdgeInsets.only(bottom: 8, left: 16, right: 16),
            decoration: BoxDecoration(
              color: Colors.redAccent.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Colors.redAccent.withValues(alpha: 0.4)),
            ),
            child: Row(
              children: [
                const SizedBox(
                  width: 12,
                  height: 12,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.redAccent),
                ),
                const SizedBox(width: 10),
                const Text(
                  'Listening... Speak now',
                  style: TextStyle(color: Colors.redAccent, fontSize: 13, fontWeight: FontWeight.bold),
                ),
                const Spacer(),
                GestureDetector(
                  onTap: _toggleListening,
                  child: const Text(
                    'Done',
                    style: TextStyle(
                      color: Colors.redAccent,
                      fontSize: 13,
                      fontWeight: FontWeight.bold,
                      decoration: TextDecoration.underline,
                    ),
                  ),
                ),
              ],
            ),
          ),

        // Input bar
        Container(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
          color: AppTheme.background,
          child: Row(
            children: [
              Expanded(
                child: Container(
                  decoration: BoxDecoration(
                    color: AppTheme.surface,
                    borderRadius: BorderRadius.circular(24),
                    border: Border.all(
                      color: _isListening ? Colors.redAccent.withValues(alpha: 0.6) : AppTheme.surfaceBorder,
                    ),
                  ),
                  child: Row(
                    children: [
                      const SizedBox(width: 14),
                      Expanded(
                        child: TextField(
                          controller: _textController,
                          style: const TextStyle(color: AppTheme.textPrimary, fontSize: 14),
                          decoration: InputDecoration(
                            hintText: _isListening ? 'Listening to your voice…' : 'Talk to Bip, search notes, or add tasks…',
                            hintStyle: TextStyle(
                              color: _isListening ? Colors.redAccent.withValues(alpha: 0.8) : AppTheme.textSecondary,
                              fontSize: 13,
                            ),
                            border: InputBorder.none,
                            contentPadding: const EdgeInsets.symmetric(vertical: 12),
                          ),
                          onSubmitted: _sendMessage,
                        ),
                      ),
                      IconButton(
                        tooltip: _isListening ? 'Stop listening' : 'Speak to Bip',
                        icon: AnimatedContainer(
                          duration: const Duration(milliseconds: 200),
                          padding: const EdgeInsets.all(4),
                          decoration: BoxDecoration(
                            color: _isListening ? Colors.redAccent.withValues(alpha: 0.2) : Colors.transparent,
                            shape: BoxShape.circle,
                          ),
                          child: Icon(
                            _isListening ? Icons.mic_rounded : Icons.mic_none_rounded,
                            color: _isListening ? Colors.redAccent : AppTheme.textSecondary,
                            size: 22,
                          ),
                        ),
                        onPressed: _toggleListening,
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 8),
              CircleAvatar(
                radius: 22,
                backgroundColor: _loading ? AppTheme.surface : AppTheme.primary,
                child: IconButton(
                  icon: _loading
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : const Icon(Icons.arrow_upward_rounded, color: Colors.white, size: 20),
                  onPressed: () => _sendMessage(_textController.text),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildThinkingBubble() {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(
              color: AppTheme.primary,
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Icon(Icons.smart_toy_rounded, color: Colors.white, size: 16),
          ),
          const SizedBox(width: 10),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              color: AppTheme.surface,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppTheme.surfaceBorder),
            ),
            child: const Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                SizedBox(
                  width: 14,
                  height: 14,
                  child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.primaryLight),
                ),
                SizedBox(width: 10),
                Text(
                  'Bip is thinking & searching your space…',
                  style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMessageItem(BipMessage message) {
    final isUser = message.role == 'user';

    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: isUser ? MainAxisAlignment.end : MainAxisAlignment.start,
        children: [
          if (!isUser) ...[
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: AppTheme.primary,
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Icon(Icons.smart_toy_rounded, color: Colors.white, size: 16),
            ),
            const SizedBox(width: 10),
          ],
          Flexible(
            child: Column(
              crossAxisAlignment: isUser ? CrossAxisAlignment.end : CrossAxisAlignment.start,
              children: [
                // Tool calls chips (if Bip executed tools)
                if (message.toolCalls != null && message.toolCalls!.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: Wrap(
                      spacing: 6,
                      runSpacing: 4,
                      children: message.toolCalls!.map((tc) {
                        final name = tc is Map ? tc['name']?.toString() ?? 'tool' : tc.toString();
                        final cleanName = name.replaceAll('_', ' ');
                        return Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: AppTheme.surface,
                            borderRadius: BorderRadius.circular(6),
                            border: Border.all(color: AppTheme.primaryLight.withValues(alpha: 0.4)),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.build_circle_outlined, size: 12, color: AppTheme.primaryLight),
                              const SizedBox(width: 4),
                              Text(
                                cleanName,
                                style: const TextStyle(fontSize: 11, color: AppTheme.primaryLight, fontWeight: FontWeight.bold),
                              ),
                            ],
                          ),
                        );
                      }).toList(),
                    ),
                  ),

                // Message bubble
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  decoration: BoxDecoration(
                    color: isUser ? AppTheme.primary : AppTheme.surface,
                    borderRadius: BorderRadius.circular(16),
                    border: isUser ? null : Border.all(color: AppTheme.surfaceBorder),
                  ),
                  child: isUser
                      ? Text(
                          message.text,
                          style: const TextStyle(color: Colors.white, fontSize: 14, height: 1.4),
                        )
                      : MarkdownBody(
                          data: message.text,
                          selectable: true,
                          styleSheet: MarkdownStyleSheet(
                            p: const TextStyle(color: AppTheme.textPrimary, fontSize: 14, height: 1.5),
                            strong: const TextStyle(fontWeight: FontWeight.bold, color: Colors.white),
                            em: const TextStyle(fontStyle: FontStyle.italic, color: AppTheme.textPrimary),
                            listBullet: const TextStyle(color: AppTheme.primaryLight, fontSize: 14),
                            code: const TextStyle(
                              backgroundColor: AppTheme.background,
                              color: AppTheme.accent,
                              fontFamily: 'monospace',
                              fontSize: 12,
                            ),
                          ),
                        ),
                ),

                // Timestamp
                Padding(
                  padding: const EdgeInsets.only(top: 4, left: 4, right: 4),
                  child: Text(
                    DateFormat('h:mm a').format(message.timestamp.toLocal()),
                    style: TextStyle(
                      fontSize: 10,
                      color: AppTheme.textSecondary.withValues(alpha: 0.6),
                    ),
                  ),
                ),
              ],
            ),
          ),
          if (isUser) const SizedBox(width: 8),
        ],
      ),
    );
  }
}
