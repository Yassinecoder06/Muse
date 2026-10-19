import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:intl/intl.dart';
import '../../data/models/chat_message.dart';
import '../../data/services/api_service.dart';
import '../../data/services/app_events.dart';
import '../../data/services/note_store.dart';
import '../../data/services/tts_service.dart';
import '../../data/services/voice_service.dart';
import '../theme/app_theme.dart';
import 'note_detail_view.dart';

class BipChatTab extends StatefulWidget {
  const BipChatTab({super.key});

  @override
  State<BipChatTab> createState() => _BipChatTabState();
}

class _BipChatTabState extends State<BipChatTab> {
  final ApiService _api = ApiService();
  final VoiceService _voice = VoiceService();
  final TtsService _tts = TtsService();
  final TextEditingController _textController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final List<BipMessage> _messages = [];
  bool _loading = false;
  bool _isListening = false;
  bool _autoReadAloud = true;
  // The server keeps the conversation; the phone only remembers which one.
  String? _sessionId;
  bool _historyLoading = true;

  final List<String> _suggestions = [
    'What notes do I have?',
    'Summarize my workout split',
    'Add task: Review proposal tomorrow',
    'What is scheduled on my calendar?',
  ];

  BipMessage get _welcome => BipMessage(
        id: 'welcome',
        role: 'assistant',
        text: "Beep boop! 🤖✨ I'm Bip, your proactive Muse AI companion.\n\nI can search your notes, manage your tasks, schedule calendar events, and answer questions about your space.",
        timestamp: DateTime.now(),
      );

  @override
  void initState() {
    super.initState();
    _messages.add(_welcome);
    _loadHistory();
    _tts.getAutoReadAloud().then((on) {
      if (mounted) setState(() => _autoReadAloud = on);
    });
    AppEvents.launchAction.addListener(_onLaunchAction);
    WidgetsBinding.instance.addPostFrameCallback((_) => _onLaunchAction());
  }

  // "Ask Bip" home-screen shortcut: open straight into voice input.
  void _onLaunchAction() {
    if (AppEvents.launchAction.value != 'ask_bip' || !mounted) return;
    AppEvents.launchAction.value = null;
    if (!_isListening) _toggleListening();
  }

  Future<void> _loadHistory() async {
    try {
      final session = await _api.fetchLatestMobileSession();
      if (!mounted) return;
      setState(() {
        if (session != null) {
          _sessionId = session['id']?.toString();
          final rows = (session['messages'] as List<dynamic>? ?? []).whereType<Map<String, dynamic>>();
          _messages
            ..clear()
            ..add(_welcome)
            ..addAll(rows.map(BipMessage.fromSession));
        }
        _historyLoading = false;
      });
      _scrollToBottom();
    } catch (_) {
      // Offline or older server: start with an empty conversation.
      if (mounted) setState(() => _historyLoading = false);
    }
  }

  Future<void> _startNewChat() async {
    if (_loading) return;
    try {
      final id = await _api.createMobileSession();
      if (!mounted) return;
      setState(() {
        _sessionId = id;
        _messages
          ..clear()
          ..add(_welcome);
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString().replaceFirst('Exception: ', '')), backgroundColor: Colors.redAccent),
        );
      }
    }
  }

  Future<void> _openNote(String noteId) async {
    try {
      final note = await NoteStore.get(_api, noteId);
      if (!mounted) return;
      await Navigator.push(context, MaterialPageRoute(builder: (_) => NoteDetailView(note: note)));
      AppEvents.notifyDataChanged();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not open that note: ${e.toString().replaceFirst('Exception: ', '')}')),
        );
      }
    }
  }

  String _initialVoiceText = '';

  @override
  void dispose() {
    AppEvents.launchAction.removeListener(_onLaunchAction);
    _voice.cancel();
    _tts.stop();
    _textController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  // Dictation keeps going (across Android's automatic pauses) until the user
  // taps the mic again.
  Future<void> _toggleListening() async {
    if (_isListening) {
      await _voice.stop();
      return;
    }
    await _tts.stop();
    _initialVoiceText = _textController.text.trim();
    final started = await _voice.startDictation(
      onText: (words) {
        if (!mounted) return;
        setState(() {
          _textController.text = _initialVoiceText.isEmpty ? words : '$_initialVoiceText $words';
          _textController.selection = TextSelection.collapsed(offset: _textController.text.length);
        });
      },
      onError: (err) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Speech error: $err'), backgroundColor: Colors.redAccent));
      },
      onStopped: () {
        if (mounted) setState(() => _isListening = false);
      },
    );
    if (!mounted) return;
    if (!started) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Microphone access is unavailable or denied. Please grant permission in App Settings.'), backgroundColor: Colors.redAccent),
      );
      return;
    }
    setState(() => _isListening = true);
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
      Map<String, dynamic> res;
      try {
        res = await _api.sendChatMessage(query, sessionId: _sessionId);
      } on Exception catch (e) {
        // The conversation was deleted on the desktop: continue in a new one.
        if (_sessionId == null || !e.toString().contains('not found')) rethrow;
        _sessionId = null;
        res = await _api.sendChatMessage(query);
      }
      _sessionId = res['sessionId']?.toString() ?? _sessionId;
      final replyText = (res['reply'] ?? res['response'] ?? 'Bip processed your request.').toString();
      final actionCards = res['actionCards'] as List<dynamic>?;
      final toolCalls = res['toolCalls'] as List<dynamic>?;
      if (actionCards != null && actionCards.isNotEmpty) AppEvents.notifyDataChanged();

      final assistantMsgId = DateTime.now().microsecondsSinceEpoch.toString();
      setState(() {
        _messages.add(BipMessage(
          id: assistantMsgId,
          role: 'assistant',
          text: replyText,
          timestamp: DateTime.now(),
          actionCards: actionCards,
          toolCalls: toolCalls,
        ));
        _loading = false;
      });

      if (_autoReadAloud) {
        _tts.speak(replyText, utteranceId: assistantMsgId);
      }
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
    return LayoutBuilder(
      builder: (context, constraints) {
        final view = View.of(context);
        final isKeyboardOpen = view.viewInsets.bottom > 0 || MediaQuery.of(context).viewInsets.bottom > 0;
        final isLandscape = MediaQuery.of(context).orientation == Orientation.landscape;
        final availableHeight = constraints.maxHeight;

        // When space is constrained (keyboard is up, landscape orientation, or short window):
        // 1. Hide quick suggestions strip to leave space for messages and input field.
        // 2. Hide top banner when height is low or when typing or in landscape.
        final isCompact = isKeyboardOpen || isLandscape || availableHeight < 320;
        final showSuggestions = !_loading && !isCompact && availableHeight > 300;
        final showTopBanner = !isCompact && availableHeight > 260;

        return Column(
          children: [
            // Top status banner (conditionally displayed based on available height)
            if (showTopBanner)
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
                    Expanded(
                      child: Text(
                        _historyLoading ? 'Loading your conversation…' : 'Bip remembers this conversation',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppTheme.textSecondary,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
                    IconButton(
                      style: IconButton.styleFrom(
                        visualDensity: VisualDensity.compact,
                        padding: const EdgeInsets.symmetric(horizontal: 4),
                      ),
                      tooltip: _autoReadAloud ? 'Voice replies: ON (tap to mute)' : 'Voice replies: MUTED (tap to unmute)',
                      icon: Icon(
                        _autoReadAloud ? Icons.volume_up_rounded : Icons.volume_off_rounded,
                        size: 18,
                        color: _autoReadAloud ? AppTheme.primaryLight : AppTheme.textSecondary,
                      ),
                      onPressed: () async {
                        final next = !_autoReadAloud;
                        await _tts.setAutoReadAloud(next);
                        setState(() => _autoReadAloud = next);
                        if (!next) await _tts.stop();
                      },
                    ),
                    TextButton.icon(
                      style: TextButton.styleFrom(
                        foregroundColor: AppTheme.accent,
                        visualDensity: VisualDensity.compact,
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                      ),
                      onPressed: _loading ? null : _startNewChat,
                      icon: const Icon(Icons.add_comment_outlined, size: 16),
                      label: const Text('New chat', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                    ),
                  ],
                ),
              ),

            // Messages list
            Expanded(
              child: ListView.builder(
                controller: _scrollController,
                padding: EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: isKeyboardOpen && isLandscape ? 6 : 16,
                ),
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
            if (showSuggestions) ...[
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
            ],

            if (_isListening)
              Container(
                padding: EdgeInsets.symmetric(horizontal: 14, vertical: isKeyboardOpen ? 4 : 8),
                margin: EdgeInsets.only(bottom: isKeyboardOpen ? 4 : 8, left: 16, right: 16),
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
              padding: EdgeInsets.fromLTRB(
                16,
                isCompact ? 4 : 8,
                16,
                isCompact ? 4 : 16,
              ),
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
                                contentPadding: EdgeInsets.symmetric(
                                  vertical: isCompact ? 8 : 12,
                                ),
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
                                size: isCompact ? 20 : 22,
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
                    radius: isCompact ? 18 : 22,
                    backgroundColor: _loading ? AppTheme.surface : AppTheme.primary,
                    child: IconButton(
                      icon: _loading
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                            )
                          : Icon(
                              Icons.arrow_upward_rounded,
                              color: Colors.white,
                              size: isCompact ? 18 : 20,
                            ),
                      onPressed: () => _sendMessage(_textController.text),
                    ),
                  ),
                ],
              ),
            ),
          ],
        );
      },
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
                              Flexible(
                                child: Text(
                                  cleanName,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(fontSize: 11, color: AppTheme.primaryLight, fontWeight: FontWeight.bold),
                                ),
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

                // What Bip did (or wants confirmed), as tappable cards.
                if (message.actionCards != null)
                  ...message.actionCards!.whereType<Map>().map(
                        (card) => card['type'] == 'confirm_required'
                            ? _ConfirmActionCard(card: card, api: _api, readOnly: message.fromHistory)
                            : _ActionCardTile(card: card, onOpenNote: _openNote),
                      ),

                // Timestamp & Read aloud button
                Padding(
                  padding: const EdgeInsets.only(top: 4, left: 4, right: 4),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        DateFormat('h:mm a').format(message.timestamp.toLocal()),
                        style: TextStyle(
                          fontSize: 10,
                          color: AppTheme.textSecondary.withValues(alpha: 0.6),
                        ),
                      ),
                      if (!isUser) ...[
                        const SizedBox(width: 8),
                        ValueListenableBuilder<String?>(
                          valueListenable: _tts.currentUtteranceId,
                          builder: (context, speakingId, _) {
                            final isSpeakingThis = speakingId == message.id;
                            return InkWell(
                              onTap: () {
                                if (isSpeakingThis) {
                                  _tts.stop();
                                } else {
                                  _tts.speak(message.text, utteranceId: message.id);
                                }
                              },
                              borderRadius: BorderRadius.circular(8),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(
                                      isSpeakingThis ? Icons.stop_circle_rounded : Icons.volume_up_rounded,
                                      size: 13,
                                      color: isSpeakingThis ? AppTheme.accent : AppTheme.textSecondary,
                                    ),
                                    const SizedBox(width: 3),
                                    Text(
                                      isSpeakingThis ? 'Stop' : 'Read aloud',
                                      style: TextStyle(
                                        fontSize: 10,
                                        fontWeight: isSpeakingThis ? FontWeight.bold : FontWeight.normal,
                                        color: isSpeakingThis ? AppTheme.accent : AppTheme.textSecondary,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            );
                          },
                        ),
                      ],
                    ],
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

class _ConfirmActionCard extends StatefulWidget {
  final Map card;
  final ApiService api;
  final bool readOnly;

  const _ConfirmActionCard({required this.card, required this.api, this.readOnly = false});

  @override
  State<_ConfirmActionCard> createState() => _ConfirmActionCardState();
}

class _ConfirmActionCardState extends State<_ConfirmActionCard> {
  String _state = 'pending'; // pending | working | done | cancelled
  String? _error;

  Map get _data => (widget.card['data'] as Map?) ?? const {};

  Future<void> _confirm() async {
    final token = _data['token']?.toString() ?? '';
    if (token.isEmpty) return;
    setState(() {
      _state = 'working';
      _error = null;
    });
    try {
      await widget.api.confirmAgentAction(token);
      AppEvents.notifyDataChanged();
      if (mounted) setState(() => _state = 'done');
    } catch (e) {
      if (mounted) {
        setState(() {
          _state = 'pending';
          _error = e.toString().replaceFirst('Exception: ', '');
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final title = (widget.card['title'] ?? _data['title'] ?? 'Item').toString();
    final itemType = (widget.card['itemType'] ?? _data['itemType'] ?? 'Item').toString();
    final status = (widget.card['status'] ?? _data['status'] ?? 'Delete').toString();
    final pending = !widget.readOnly && (_state == 'pending' || _state == 'working');

    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.redAccent.withValues(alpha: 0.6)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            _state == 'done'
                ? '$itemType · Done'
                : _state == 'cancelled'
                    ? '$itemType · Cancelled'
                    : widget.readOnly
                        ? '$itemType · Not confirmed (ask Bip again)'
                        : '$itemType · Needs your confirmation',
            style: const TextStyle(fontSize: 11, color: Colors.redAccent, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 4),
          Text(title, style: const TextStyle(color: AppTheme.textPrimary, fontSize: 14, fontWeight: FontWeight.w600)),
          if (_error != null) ...[
            const SizedBox(height: 4),
            Text(_error!, style: const TextStyle(color: Colors.redAccent, fontSize: 12)),
          ],
          if (pending) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                FilledButton(
                  style: FilledButton.styleFrom(backgroundColor: Colors.redAccent),
                  onPressed: _state == 'working' ? null : _confirm,
                  child: Text(_state == 'working' ? 'Working…' : '$status ${itemType.toLowerCase()}'),
                ),
                const SizedBox(width: 8),
                TextButton(
                  onPressed: _state == 'working' ? null : () => setState(() => _state = 'cancelled'),
                  child: const Text('Cancel'),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

/// Compact summary of something Bip created, changed, or deleted.
class _ActionCardTile extends StatelessWidget {
  final Map card;
  final void Function(String noteId) onOpenNote;

  const _ActionCardTile({required this.card, required this.onOpenNote});

  @override
  Widget build(BuildContext context) {
    final data = (card['data'] as Map?) ?? const {};
    final type = card['type']?.toString() ?? '';
    final id = (card['id'] ?? data['id'])?.toString();
    String field(String key) => (card[key] ?? data[key] ?? '').toString();

    late IconData icon;
    late Color color;
    late String label;
    String title = field('title');
    String subtitle = '';
    bool opensNote = false;

    switch (type) {
      case 'note':
      case 'note_updated':
      case 'specialized_note':
        icon = Icons.description_outlined;
        color = AppTheme.primaryLight;
        label = type == 'note_updated' ? 'Note updated' : 'Note created';
        subtitle = field('contentSnippet');
        opensNote = id != null && id.isNotEmpty;
      case 'task':
      case 'task_updated':
        icon = (card['completed'] ?? data['completed']) == true ? Icons.check_circle_outline : Icons.radio_button_unchecked;
        color = AppTheme.accent;
        label = type == 'task_updated' ? 'Task updated' : 'Task added';
        title = field('text');
        final due = (card['dueDate'] ?? data['due_date'])?.toString();
        subtitle = [if (due != null && due.isNotEmpty && due != 'null') 'Due $due', field('priority')].where((s) => s.isNotEmpty).join(' · ');
      case 'event':
        icon = Icons.event_outlined;
        color = Colors.lightBlueAccent;
        label = 'Event scheduled';
        final start = DateTime.tryParse((card['startTime'] ?? data['start_time'] ?? '').toString());
        subtitle = [if (start != null) DateFormat('EEE, MMM d · h:mm a').format(start.toLocal()), field('location')].where((s) => s.isNotEmpty).join(' · ');
      case 'memory':
        icon = Icons.psychology_outlined;
        color = Colors.amberAccent;
        label = 'Bip will remember';
        title = field('fact');
      case 'template':
        icon = Icons.dashboard_customize_outlined;
        color = AppTheme.primaryLight;
        label = 'Template saved';
      case 'item_deleted':
        icon = Icons.delete_outline_rounded;
        color = Colors.redAccent;
        label = field('status').isEmpty ? 'Deleted' : field('status');
      default:
        return const SizedBox.shrink();
    }
    if (title.isEmpty) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Material(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: opensNote ? () => onOpenNote(id!) : null,
          child: Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              border: Border(left: BorderSide(color: color, width: 3)),
            ),
            child: Row(
              children: [
                Icon(icon, size: 20, color: color),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(label, style: TextStyle(fontSize: 11, color: color, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 2),
                      Text(
                        title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: AppTheme.textPrimary,
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          decoration: type == 'item_deleted' ? TextDecoration.lineThrough : null,
                        ),
                      ),
                      if (subtitle.isNotEmpty)
                        Text(subtitle, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
                    ],
                  ),
                ),
                if (opensNote) const Icon(Icons.chevron_right_rounded, color: AppTheme.textSecondary),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
