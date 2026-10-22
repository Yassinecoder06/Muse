import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:intl/intl.dart';
import '../../data/models/chat_message.dart';
import '../../data/models/chat_session.dart';
import '../../data/services/api_service.dart';
import '../../data/services/app_events.dart';
import '../../data/services/music_service.dart';
import '../../data/services/note_store.dart';
import '../../data/services/tts_service.dart';
import '../../data/services/voice_service.dart';
import '../theme/app_theme.dart';
import '../widgets/bip_memories_sheet.dart';
import 'note_detail_view.dart';

class BipChatScreen extends StatelessWidget {
  final bool startWithVoice;

  const BipChatScreen({super.key, this.startWithVoice = false});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.getBackground(context),
      body: SafeArea(
        child: BipChatTab(
          showBackButton: true,
          startWithVoice: startWithVoice,
        ),
      ),
    );
  }
}

class BipChatTab extends StatefulWidget {
  final bool showBackButton;
  final bool startWithVoice;

  const BipChatTab({
    super.key,
    this.showBackButton = false,
    this.startWithVoice = false,
  });

  @override
  State<BipChatTab> createState() => _BipChatTabState();
}

class _BipChatTabState extends State<BipChatTab> {
  final GlobalKey<ScaffoldState> _innerScaffoldKey = GlobalKey<ScaffoldState>();
  final ApiService _api = ApiService();
  final VoiceService _voice = VoiceService();
  final TtsService _tts = TtsService();
  final TextEditingController _textController = TextEditingController();
  final TextEditingController _searchController = TextEditingController();
  final ScrollController _scrollController = ScrollController();

  final List<BipMessage> _messages = [];
  List<ChatSession> _sessions = [];
  String? _activeSessionId;
  String _activeSessionTitle = 'Mobile Companion';
  int _memoriesCount = 0;

  bool _loading = false;
  bool _sessionsLoading = true;
  bool _isListening = false;
  bool _autoReadAloud = true;
  String _sessionSearchQuery = '';

  // Audio Playback for Music Cards
  String? get _currentlyPlayingFilename =>
      MusicService.instance.currentTrack.value?['filename'] as String?;
  PlayerState get _musicPlayerState => MusicService.instance.playerState.value;

  final List<String> _suggestions = [
    'What notes do I have?',
    'Summarize my workout split',
    'Add task: Review proposal tomorrow',
    'What is scheduled on my calendar?',
    'Play music lofi',
    'Remember that I prefer dark mode',
  ];

  BipMessage get _welcome => BipMessage(
        id: 'welcome',
        role: 'assistant',
        text: "Beep boop! 🤖✨ I'm Bip, your proactive Muse AI companion.\n\nI can search your notes, manage tasks, schedule calendar events, play music, and remember your space.",
        timestamp: DateTime.now(),
      );

  @override
  void initState() {
    super.initState();
    _messages.add(_welcome);
    MusicService.instance.currentTrack.addListener(_onMusicServiceChanged);
    MusicService.instance.playerState.addListener(_onMusicServiceChanged);
    _loadInitialData();

    _tts.getAutoReadAloud().then((on) {
      if (mounted) setState(() => _autoReadAloud = on);
    });

    AppEvents.launchAction.addListener(_onLaunchAction);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _onLaunchAction();
      if (widget.startWithVoice && !_isListening) {
        _toggleListening();
      }
    });
  }

  void _onMusicServiceChanged() {
    if (mounted) setState(() {});
  }

  void _onLaunchAction() {
    if (AppEvents.launchAction.value != 'ask_bip' || !mounted) return;
    AppEvents.launchAction.value = null;
    if (!_isListening) _toggleListening();
  }

  Future<void> _loadInitialData() async {
    await Future.wait([
      _loadSessions(),
      _loadMemoriesCount(),
    ]);
  }

  Future<void> _loadMemoriesCount() async {
    try {
      final mems = await _api.fetchMemories();
      if (mounted) setState(() => _memoriesCount = mems.length);
    } catch (_) {}
  }

  Future<void> _loadSessions() async {
    setState(() => _sessionsLoading = true);
    try {
      final rawList = await _api.fetchChatSessions();
      if (!mounted) return;
      final parsed = rawList.map(ChatSession.fromJson).toList();

      setState(() {
        _sessions = parsed;
        _sessionsLoading = false;
      });

      if (parsed.isNotEmpty && _activeSessionId == null) {
        // Find most recent mobile or general session
        final preferred = parsed.firstWhere(
          (s) => s.contextType == 'mobile',
          orElse: () => parsed.first,
        );
        await _selectSession(preferred.id, preferred.title);
      } else if (parsed.isEmpty) {
        await _startNewChat();
      }
    } catch (_) {
      if (mounted) setState(() => _sessionsLoading = false);
    }
  }

  Future<void> _selectSession(String sessionId, String title) async {
    setState(() {
      _activeSessionId = sessionId;
      _activeSessionTitle = title;
      _loading = true;
    });

    try {
      final data = await _api.fetchChatSession(sessionId);
      if (!mounted) return;

      final rawMessages = (data['messages'] as List<dynamic>? ?? []).whereType<Map<String, dynamic>>();
      final history = rawMessages.map(BipMessage.fromSession).toList();

      setState(() {
        _activeSessionTitle = data['title']?.toString() ?? title;
        _messages
          ..clear()
          ..add(_welcome)
          ..addAll(history);
        _loading = false;
      });
      _scrollToBottom();
    } catch (e) {
      if (mounted) {
        setState(() => _loading = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to load session: $e'), backgroundColor: Colors.redAccent),
        );
      }
    }
  }

  Future<void> _startNewChat() async {
    if (_loading) return;
    try {
      final created = await _api.createChatSession(
        title: 'New Conversation',
        contextType: 'general',
      );
      final newSession = ChatSession.fromJson(created);

      if (!mounted) return;
      setState(() {
        _sessions.insert(0, newSession);
        _activeSessionId = newSession.id;
        _activeSessionTitle = newSession.title;
        _messages
          ..clear()
          ..add(_welcome);
      });
      if (_innerScaffoldKey.currentState?.isDrawerOpen ?? false) {
        Navigator.pop(context);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to create new chat: $e'), backgroundColor: Colors.redAccent),
        );
      }
    }
  }

  Future<void> _renameSession(ChatSession session) async {
    final controller = TextEditingController(text: session.title);
    final newTitle = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.getSurface(ctx),
        title: Text('Rename Conversation', style: TextStyle(color: AppTheme.getTextPrimary(ctx), fontSize: 16)),
        content: TextField(
          controller: controller,
          autofocus: true,
          style: TextStyle(color: AppTheme.getTextPrimary(ctx)),
          decoration: InputDecoration(
            hintText: 'Enter title...',
            hintStyle: TextStyle(color: AppTheme.getTextSecondary(ctx)),
          ),
          onSubmitted: (v) => Navigator.pop(ctx, v.trim()),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('Save'),
          ),
        ],
      ),
    );

    if (newTitle == null || newTitle.isEmpty || newTitle == session.title) return;

    try {
      await _api.updateChatSession(session.id, newTitle);
      if (!mounted) return;
      setState(() {
        final idx = _sessions.indexWhere((s) => s.id == session.id);
        if (idx != -1) {
          _sessions[idx] = _sessions[idx].copyWith(title: newTitle);
        }
        if (_activeSessionId == session.id) {
          _activeSessionTitle = newTitle;
        }
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to rename: $e'), backgroundColor: Colors.redAccent),
        );
      }
    }
  }

  Future<void> _deleteSession(ChatSession session) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.getSurface(ctx),
        title: Text('Delete Conversation?', style: TextStyle(color: AppTheme.getTextPrimary(ctx), fontSize: 16)),
        content: Text(
          'This will permanently delete "${session.title}" and its message history.',
          style: TextStyle(color: AppTheme.getTextSecondary(ctx), fontSize: 13),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.redAccent),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );

    if (confirm != true) return;

    try {
      await _api.deleteChatSession(session.id);
      if (!mounted) return;
      setState(() {
        _sessions.removeWhere((s) => s.id == session.id);
      });

      if (_activeSessionId == session.id) {
        if (_sessions.isNotEmpty) {
          await _selectSession(_sessions.first.id, _sessions.first.title);
        } else {
          await _startNewChat();
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to delete: $e'), backgroundColor: Colors.redAccent),
        );
      }
    }
  }

  Future<void> _playSong(String filename, String title) async {
    try {
      final music = MusicService.instance;
      final current = music.currentTrack.value;
      final isCurrent = (current != null &&
          (current['filename'] == filename || current['title'] == title));

      if (isCurrent && music.playerState.value == PlayerState.playing) {
        await music.pause();
        return;
      }
      if (isCurrent && music.playerState.value == PlayerState.paused) {
        await music.resume();
        return;
      }

      await music.playSong({
        'filename': filename,
        'title': title,
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to play $title: $e'), backgroundColor: Colors.redAccent),
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
          SnackBar(content: Text('Could not open note: $e'), backgroundColor: Colors.redAccent),
        );
      }
    }
  }

  Future<void> _toggleTaskCompleted(String taskId, bool currentCompleted) async {
    final next = !currentCompleted;
    try {
      await _api.toggleTaskCompleted(taskId, next);
      AppEvents.notifyDataChanged();
      // Update local card state in messages
      setState(() {
        for (final msg in _messages) {
          if (msg.actionCards != null) {
            for (final card in msg.actionCards!) {
              if (card is Map && (card['id']?.toString() == taskId || card['data']?['id']?.toString() == taskId)) {
                card['completed'] = next;
                if (card['data'] is Map) card['data']['completed'] = next;
              }
            }
          }
        }
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to update task: $e'), backgroundColor: Colors.redAccent),
        );
      }
    }
  }

  @override
  void dispose() {
    AppEvents.launchAction.removeListener(_onLaunchAction);
    MusicService.instance.currentTrack.removeListener(_onMusicServiceChanged);
    MusicService.instance.playerState.removeListener(_onMusicServiceChanged);
    _voice.cancel();
    _tts.stop();
    _textController.dispose();
    _searchController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  String _initialVoiceText = '';

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
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Speech error: $err'), backgroundColor: Colors.redAccent),
        );
      },
      onStopped: () {
        if (mounted) setState(() => _isListening = false);
      },
    );
    if (!mounted) return;
    if (!started) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Microphone access is unavailable or denied.'),
          backgroundColor: Colors.redAccent,
        ),
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

    if (_isListening) {
      await _voice.stop();
      setState(() => _isListening = false);
    }

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
      final res = await _api.sendChatMessage(query, sessionId: _activeSessionId);
      final replyText = (res['reply'] ?? res['response'] ?? 'Bip processed your request.').toString();
      final actionCards = (res['actionCards'] ?? res['action_cards']) as List<dynamic>?;
      final toolCalls = (res['toolCalls'] ?? res['tool_calls']) as List<dynamic>?;

      // Update session title if returned
      final returnedTitle = res['sessionTitle'] as String?;
      if (returnedTitle != null && returnedTitle.isNotEmpty) {
        setState(() {
          _activeSessionTitle = returnedTitle;
          final idx = _sessions.indexWhere((s) => s.id == _activeSessionId);
          if (idx != -1) {
            _sessions[idx] = _sessions[idx].copyWith(title: returnedTitle);
          }
        });
      }

      if (actionCards != null && actionCards.isNotEmpty) {
        AppEvents.notifyDataChanged();

        // Check if any music card was returned to trigger audio
        final musicCard = actionCards.firstWhere(
          (c) => c is Map && (c['type'] == 'music' || c['data']?['type'] == 'music'),
          orElse: () => null,
        );
        if (musicCard is Map) {
          final data = (musicCard['data'] as Map?) ?? musicCard;
          final filename = data['filename']?.toString();
          final title = (data['title'] ?? filename)?.toString() ?? 'Track';
          if (filename != null && filename.isNotEmpty) {
            unawaited(_playSong(filename, title));
          }
        }
      }

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
          text: "I couldn't reach Muse right now: ${e.toString().replaceFirst('Exception: ', '')}",
          timestamp: DateTime.now(),
        ));
        _loading = false;
      });
    }
    _scrollToBottom();
  }

  Widget _buildMarkdownImage(String raw, String? alt) {
    if (raw.startsWith('data:image/')) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: Image.memory(
            UriData.parse(raw).contentAsBytes(),
            fit: BoxFit.contain,
            errorBuilder: (_, error, stack) => const Icon(Icons.broken_image_outlined, size: 24),
          ),
        ),
      );
    }
    return FutureBuilder<String>(
      future: _api.resolveUrl(raw),
      builder: (context, snapshot) {
        if (!snapshot.hasData) return const SizedBox(height: 40);
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: Image.network(
              snapshot.data!,
              fit: BoxFit.contain,
              errorBuilder: (_, error, stack) => const Icon(Icons.broken_image_outlined, size: 24),
            ),
          ),
        );
      },
    );
  }

  Widget _buildUserMessageContent(BuildContext context, String text) {
    final imgRegex = RegExp(r'!\[([^\]]*)\]\(([^)]+)\)');
    final matches = imgRegex.allMatches(text).toList();
    if (matches.isEmpty) {
      return Text(
        text,
        style: const TextStyle(color: Colors.white, fontSize: 14, height: 1.4),
      );
    }

    final cleanText = text.replaceAll(imgRegex, '').trim();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final m in matches) ...[
          _buildMarkdownImage(m.group(2) ?? '', m.group(1)),
          const SizedBox(height: 6),
        ],
        if (cleanText.isNotEmpty)
          Text(
            cleanText,
            style: const TextStyle(color: Colors.white, fontSize: 14, height: 1.4),
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      key: _innerScaffoldKey,
      backgroundColor: AppTheme.getBackground(context),
      drawer: _buildSessionsDrawer(),
      body: LayoutBuilder(
        builder: (context, constraints) {
          final view = View.of(context);
          final isKeyboardOpen = view.viewInsets.bottom > 0 || MediaQuery.of(context).viewInsets.bottom > 0;
          final isLandscape = MediaQuery.of(context).orientation == Orientation.landscape;
          final availableHeight = constraints.maxHeight;

          final isCompact = isKeyboardOpen || (isLandscape && availableHeight < 500) || availableHeight < 320;
          final showSuggestions = !_loading && !isCompact && availableHeight > 320;

          return Column(
            children: [
              _buildTopAppBar(context),

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
                          label: Text(text, style: TextStyle(fontSize: 12, color: AppTheme.getTextPrimary(context))),
                          backgroundColor: AppTheme.getSurface(context),
                          side: BorderSide(color: AppTheme.getSurfaceBorder(context)),
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
              _buildInputBar(isCompact),
            ],
          );
        },
      ),
    );
  }

  Widget _buildTopAppBar(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(8, 8, 8, 8),
      decoration: BoxDecoration(
        color: AppTheme.getSurface(context),
        border: Border(bottom: BorderSide(color: AppTheme.getSurfaceBorder(context))),
      ),
      child: Row(
        children: [
          if (widget.showBackButton)
            IconButton(
              icon: const Icon(Icons.arrow_back_rounded),
              color: AppTheme.getTextPrimary(context),
              tooltip: 'Back',
              onPressed: () => Navigator.pop(context),
            ),
          IconButton(
            icon: Badge(
              label: Text('${_sessions.length}'),
              isLabelVisible: _sessions.isNotEmpty,
              backgroundColor: AppTheme.primaryLight,
              textColor: Colors.black,
              child: const Icon(Icons.forum_outlined),
            ),
            color: AppTheme.getTextPrimary(context),
            tooltip: 'Conversations (${_sessions.length})',
            onPressed: () => _innerScaffoldKey.currentState?.openDrawer(),
          ),
          const SizedBox(width: 4),
          Expanded(
            child: GestureDetector(
              onTap: () {
                final current = _sessions.firstWhere((s) => s.id == _activeSessionId, orElse: () => ChatSession(id: _activeSessionId ?? '', title: _activeSessionTitle, createdAt: DateTime.now(), updatedAt: DateTime.now()));
                _renameSession(current);
              },
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Flexible(
                        child: Text(
                          _activeSessionTitle,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.bold,
                            color: AppTheme.getTextPrimary(context),
                          ),
                        ),
                      ),
                      const SizedBox(width: 4),
                      Icon(Icons.edit_outlined, size: 12, color: AppTheme.getTextSecondary(context).withValues(alpha: 0.6)),
                    ],
                  ),
                  Text(
                    'Bip remembers this conversation',
                    style: TextStyle(
                      fontSize: 10,
                      color: AppTheme.getTextSecondary(context),
                    ),
                  ),
                ],
              ),
            ),
          ),
          IconButton(
            icon: Icon(
              _autoReadAloud ? Icons.volume_up_rounded : Icons.volume_off_rounded,
              size: 20,
              color: _autoReadAloud ? AppTheme.primaryLight : AppTheme.getTextSecondary(context),
            ),
            tooltip: _autoReadAloud ? 'Voice replies: ON' : 'Voice replies: MUTED',
            onPressed: () async {
              final next = !_autoReadAloud;
              await _tts.setAutoReadAloud(next);
              setState(() => _autoReadAloud = next);
              if (!next) await _tts.stop();
            },
          ),
          IconButton(
            icon: Badge(
              label: Text('$_memoriesCount'),
              isLabelVisible: _memoriesCount > 0,
              backgroundColor: Colors.amberAccent,
              textColor: Colors.black,
              child: const Icon(Icons.psychology_outlined, size: 20),
            ),
            color: Colors.amberAccent,
            tooltip: 'User Memories ($_memoriesCount)',
            onPressed: () => BipMemoriesSheet.show(context).then((_) => _loadMemoriesCount()),
          ),
          TextButton.icon(
            style: TextButton.styleFrom(
              foregroundColor: AppTheme.primaryLight,
              visualDensity: VisualDensity.compact,
              padding: const EdgeInsets.symmetric(horizontal: 6),
            ),
            icon: const Icon(Icons.add_comment_outlined, size: 16),
            label: const Text('New chat', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
            onPressed: _loading ? null : _startNewChat,
          ),
        ],
      ),
    );
  }

  Widget _buildSessionsDrawer() {
    final filtered = _sessionSearchQuery.isEmpty
        ? _sessions
        : _sessions.where((s) => s.title.toLowerCase().contains(_sessionSearchQuery.toLowerCase())).toList();

    final now = DateTime.now();
    final today = filtered.where((s) => now.difference(s.updatedAt).inHours < 24).toList();
    final pastWeek = filtered.where((s) => now.difference(s.updatedAt).inDays >= 1 && now.difference(s.updatedAt).inDays <= 7).toList();
    final older = filtered.where((s) => now.difference(s.updatedAt).inDays > 7).toList();

    return Drawer(
      backgroundColor: AppTheme.getSurface(context),
      child: SafeArea(
        child: Column(
          children: [
            // Header
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(
                      color: AppTheme.primary,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Icon(Icons.smart_toy_rounded, color: Colors.white, size: 16),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Conversations',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                        color: AppTheme.getTextPrimary(context),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  FilledButton.icon(
                    style: FilledButton.styleFrom(
                      backgroundColor: AppTheme.primaryLight,
                      foregroundColor: Colors.black,
                      visualDensity: VisualDensity.compact,
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                    ),
                    icon: const Icon(Icons.add_rounded, size: 14),
                    label: const Text('New', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 11)),
                    onPressed: _startNewChat,
                  ),
                ],
              ),
            ),

            // Search bar
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
              child: TextField(
                controller: _searchController,
                style: TextStyle(color: AppTheme.getTextPrimary(context), fontSize: 13),
                decoration: InputDecoration(
                  hintText: 'Search chats...',
                  hintStyle: TextStyle(color: AppTheme.getTextSecondary(context), fontSize: 12),
                  prefixIcon: const Icon(Icons.search_rounded, size: 18),
                  suffixIcon: _sessionSearchQuery.isNotEmpty
                      ? IconButton(
                          icon: const Icon(Icons.clear_rounded, size: 16),
                          onPressed: () {
                            _searchController.clear();
                            setState(() => _sessionSearchQuery = '');
                          },
                        )
                      : null,
                  filled: true,
                  fillColor: AppTheme.getBackground(context),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: BorderSide(color: AppTheme.getSurfaceBorder(context)),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: BorderSide(color: AppTheme.getSurfaceBorder(context)),
                  ),
                ),
                onChanged: (val) => setState(() => _sessionSearchQuery = val.trim()),
              ),
            ),
            const Divider(height: 1),

            // Sessions list
            Expanded(
              child: _sessionsLoading
                  ? const Center(child: CircularProgressIndicator())
                  : filtered.isEmpty
                      ? Center(
                          child: Text(
                            _sessionSearchQuery.isNotEmpty ? 'No conversations found' : 'No conversations yet',
                            style: TextStyle(color: AppTheme.getTextSecondary(context), fontSize: 13),
                          ),
                        )
                      : ListView(
                          padding: const EdgeInsets.symmetric(vertical: 8),
                          children: [
                            if (today.isNotEmpty) ...[
                              _buildSectionHeader('Today'),
                              ...today.map(_buildSessionTile),
                            ],
                            if (pastWeek.isNotEmpty) ...[
                              _buildSectionHeader('Previous 7 Days'),
                              ...pastWeek.map(_buildSessionTile),
                            ],
                            if (older.isNotEmpty) ...[
                              _buildSectionHeader('Older'),
                              ...older.map(_buildSessionTile),
                            ],
                          ],
                        ),
            ),

            const Divider(height: 1),
            // Footer with memories
            ListTile(
              leading: const Icon(Icons.psychology_outlined, color: Colors.amberAccent),
              title: Text('Memories ($_memoriesCount)', style: TextStyle(color: AppTheme.getTextPrimary(context), fontSize: 13, fontWeight: FontWeight.w600)),
              subtitle: Text('Manage what Bip remembers', style: TextStyle(color: AppTheme.getTextSecondary(context), fontSize: 11)),
              trailing: const Icon(Icons.chevron_right_rounded, size: 18),
              onTap: () {
                Navigator.pop(context);
                BipMemoriesSheet.show(context).then((_) => _loadMemoriesCount());
              },
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSectionHeader(String title) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: Text(
        title.toUpperCase(),
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.bold,
          letterSpacing: 0.8,
          color: AppTheme.getTextSecondary(context),
        ),
      ),
    );
  }

  Widget _buildSessionTile(ChatSession session) {
    final isActive = session.id == _activeSessionId;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
      child: Material(
        color: isActive ? AppTheme.primaryLight.withValues(alpha: 0.15) : Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10),
          side: isActive
              ? BorderSide(color: AppTheme.primaryLight.withValues(alpha: 0.4))
              : BorderSide.none,
        ),
        child: ListTile(
          dense: true,
          contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
          leading: Icon(
            Icons.chat_bubble_outline_rounded,
            size: 18,
            color: isActive ? AppTheme.primaryLight : AppTheme.getTextSecondary(context),
          ),
          title: Text(
            session.title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 13,
              fontWeight: isActive ? FontWeight.bold : FontWeight.w500,
              color: isActive ? AppTheme.getTextPrimary(context) : AppTheme.getTextPrimary(context).withValues(alpha: 0.85),
            ),
          ),
          subtitle: Text(
            DateFormat('MMM d, h:mm a').format(session.updatedAt.toLocal()),
            style: TextStyle(fontSize: 10, color: AppTheme.getTextSecondary(context)),
          ),
          trailing: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              IconButton(
                icon: const Icon(Icons.edit_outlined, size: 16),
                tooltip: 'Rename',
                color: AppTheme.getTextSecondary(context),
                onPressed: () => _renameSession(session),
              ),
              IconButton(
                icon: const Icon(Icons.delete_outline_rounded, size: 16),
                tooltip: 'Delete',
                color: Colors.redAccent.withValues(alpha: 0.8),
                onPressed: () => _deleteSession(session),
              ),
            ],
          ),
          onTap: () {
            Navigator.pop(context); // close drawer
            _selectSession(session.id, session.title);
          },
        ),
      ),
    );
  }

  Widget _buildInputBar(bool isCompact) {
    return Container(
      padding: EdgeInsets.fromLTRB(16, isCompact ? 4 : 8, 16, isCompact ? 4 : 16),
      color: AppTheme.getBackground(context),
      child: Row(
        children: [
          Expanded(
            child: Container(
              decoration: BoxDecoration(
                color: AppTheme.getSurface(context),
                borderRadius: BorderRadius.circular(24),
                border: Border.all(
                  color: _isListening ? Colors.redAccent.withValues(alpha: 0.6) : AppTheme.getSurfaceBorder(context),
                ),
              ),
              child: Row(
                children: [
                  const SizedBox(width: 14),
                  Expanded(
                    child: TextField(
                      controller: _textController,
                      style: TextStyle(color: AppTheme.getTextPrimary(context), fontSize: 14),
                      decoration: InputDecoration(
                        hintText: _isListening ? 'Listening to your voice…' : 'Talk to Bip, search notes, or add tasks…',
                        hintStyle: TextStyle(
                          color: _isListening ? Colors.redAccent.withValues(alpha: 0.8) : AppTheme.getTextSecondary(context),
                          fontSize: 13,
                        ),
                        border: InputBorder.none,
                        contentPadding: EdgeInsets.symmetric(vertical: isCompact ? 8 : 12),
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
                        color: _isListening ? Colors.redAccent : AppTheme.getTextSecondary(context),
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
            backgroundColor: _loading ? AppTheme.getSurface(context) : AppTheme.primary,
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
              color: AppTheme.getSurface(context),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppTheme.getSurfaceBorder(context)),
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
                // Tool calls chips
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
                            color: AppTheme.getSurface(context),
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
                    color: isUser ? AppTheme.primary : AppTheme.getSurface(context),
                    borderRadius: BorderRadius.circular(16),
                    border: isUser ? null : Border.all(color: AppTheme.getSurfaceBorder(context)),
                  ),
                  child: isUser
                      ? _buildUserMessageContent(context, message.text)
                      : MarkdownBody(
                          data: message.text,
                          selectable: true,
                          sizedImageBuilder: (config) => _buildMarkdownImage(config.uri.toString(), config.alt),
                          styleSheet: MarkdownStyleSheet(
                            p: TextStyle(color: AppTheme.getTextPrimary(context), fontSize: 14, height: 1.5),
                            strong: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.getTextPrimary(context)),
                            em: TextStyle(fontStyle: FontStyle.italic, color: AppTheme.getTextPrimary(context)),
                            listBullet: const TextStyle(color: AppTheme.primaryLight, fontSize: 14),
                            code: TextStyle(
                              backgroundColor: AppTheme.getBackground(context),
                              color: AppTheme.accent,
                              fontFamily: 'monospace',
                              fontSize: 12,
                            ),
                          ),
                        ),
                ),

                // Action cards
                if (message.actionCards != null)
                  ...message.actionCards!.whereType<Map>().map(
                        (card) => card['type'] == 'confirm_required'
                            ? _ConfirmActionCard(card: card, api: _api, readOnly: message.fromHistory)
                            : _ActionCardTile(
                                card: card,
                                onOpenNote: _openNote,
                                onToggleTask: _toggleTaskCompleted,
                                onPlaySong: _playSong,
                                currentlyPlayingFilename: _currentlyPlayingFilename,
                                isPlaying: _musicPlayerState == PlayerState.playing,
                              ),
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
                          color: AppTheme.getTextSecondary(context).withValues(alpha: 0.6),
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
                                      color: isSpeakingThis ? AppTheme.accent : AppTheme.getTextSecondary(context),
                                    ),
                                    const SizedBox(width: 3),
                                    Text(
                                      isSpeakingThis ? 'Stop' : 'Read aloud',
                                      style: TextStyle(
                                        fontSize: 10,
                                        fontWeight: isSpeakingThis ? FontWeight.bold : FontWeight.normal,
                                        color: isSpeakingThis ? AppTheme.accent : AppTheme.getTextSecondary(context),
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
    final token = (_data['token'] ?? widget.card['token'])?.toString() ?? '';
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
        color: AppTheme.getSurface(context),
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
          Text(title, style: TextStyle(color: AppTheme.getTextPrimary(context), fontSize: 14, fontWeight: FontWeight.w600)),
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

class _ActionCardTile extends StatelessWidget {
  final Map card;
  final void Function(String noteId) onOpenNote;
  final void Function(String taskId, bool currentCompleted) onToggleTask;
  final void Function(String filename, String title) onPlaySong;
  final String? currentlyPlayingFilename;
  final bool isPlaying;

  const _ActionCardTile({
    required this.card,
    required this.onOpenNote,
    required this.onToggleTask,
    required this.onPlaySong,
    this.currentlyPlayingFilename,
    this.isPlaying = false,
  });

  @override
  Widget build(BuildContext context) {
    final data = (card['data'] as Map?) ?? const {};
    final type = (card['type'] ?? data['type'])?.toString() ?? '';
    final id = (card['id'] ?? data['id'])?.toString();
    String field(String key) => (card[key] ?? data[key] ?? '').toString();

    late IconData icon;
    late Color color;
    late String label;
    String title = field('title');
    String subtitle = '';
    bool opensNote = false;
    bool isTaskCard = false;
    bool taskCompleted = false;
    bool isMusicCard = false;
    String musicFilename = '';

    switch (type) {
      case 'note':
      case 'note_updated':
      case 'specialized_note':
        icon = Icons.description_outlined;
        color = AppTheme.primaryLight;
        label = type == 'note_updated' ? 'Note updated' : 'Note created';
        subtitle = field('contentSnippet');
        if (subtitle.isEmpty) subtitle = field('snippet');
        opensNote = id != null && id.isNotEmpty;
        break;

      case 'task':
      case 'task_updated':
        isTaskCard = true;
        taskCompleted = (card['completed'] ?? data['completed']) == true;
        icon = taskCompleted ? Icons.check_circle_outline : Icons.radio_button_unchecked;
        color = AppTheme.accent;
        label = type == 'task_updated' ? 'Task updated' : 'Task added';
        title = field('text');
        final due = (card['dueDate'] ?? data['due_date'])?.toString();
        subtitle = [if (due != null && due.isNotEmpty && due != 'null') 'Due $due', field('priority')].where((s) => s.isNotEmpty).join(' · ');
        break;

      case 'event':
        icon = Icons.event_outlined;
        color = Colors.lightBlueAccent;
        label = 'Event scheduled';
        final start = DateTime.tryParse((card['startTime'] ?? data['start_time'] ?? '').toString());
        subtitle = [if (start != null) DateFormat('EEE, MMM d · h:mm a').format(start.toLocal()), field('location')].where((s) => s.isNotEmpty).join(' · ');
        break;

      case 'memory':
        icon = Icons.psychology_outlined;
        color = Colors.amberAccent;
        label = 'Bip will remember';
        title = field('fact');
        break;

      case 'template':
        icon = Icons.dashboard_customize_outlined;
        color = AppTheme.primaryLight;
        label = 'Template saved';
        break;

      case 'item_deleted':
        icon = Icons.delete_outline_rounded;
        color = Colors.redAccent;
        label = field('status').isEmpty ? 'Deleted' : field('status');
        break;

      case 'music':
        isMusicCard = true;
        icon = Icons.music_note_rounded;
        color = const Color(0xFF00E5FF);
        label = 'Music Player';
        musicFilename = field('filename');
        if (title.isEmpty) title = musicFilename;
        subtitle = field('artist').isNotEmpty ? field('artist') : 'Muse Audio';
        break;

      case 'generated_image':
        icon = Icons.image_outlined;
        color = const Color(0xFFEC4899);
        label = 'Generated Image';
        final prompt = field('prompt').isNotEmpty ? field('prompt') : field('contentSnippet');
        if (title.isEmpty) title = 'Image by Gemini';
        subtitle = prompt;
        break;

      case 'playlist':
        icon = Icons.playlist_play_rounded;
        color = const Color(0xFF00E5FF);
        label = 'Playlist';
        title = field('title').isNotEmpty ? field('title') : field('name');
        final tracks = (card['tracks'] ?? data['tracks']) as List<dynamic>? ?? [];
        subtitle = '${tracks.length} tracks in playlist';
        break;

      case 'music_download_plan':
      case 'music_download_progress':
        icon = Icons.downloading_rounded;
        color = Colors.tealAccent;
        label = 'Music Download';
        title = 'Downloading music batch';
        final songs = (card['songs'] ?? data['songs']) as List<dynamic>? ?? [];
        subtitle = '${songs.length} song(s) queued for download';
        break;

      default:
        return const SizedBox.shrink();
    }
    if (title.isEmpty) return const SizedBox.shrink();

    final isThisSongPlaying = isMusicCard && musicFilename.isNotEmpty && currentlyPlayingFilename == musicFilename && isPlaying;

    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Material(
        color: AppTheme.getSurface(context),
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
                if (isTaskCard && id != null)
                  IconButton(
                    icon: Icon(
                      taskCompleted ? Icons.check_circle_rounded : Icons.radio_button_unchecked,
                      color: taskCompleted ? AppTheme.accent : AppTheme.getTextSecondary(context),
                      size: 22,
                    ),
                    onPressed: () => onToggleTask(id, taskCompleted),
                  )
                else
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
                          color: AppTheme.getTextPrimary(context),
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          decoration: type == 'item_deleted' || (isTaskCard && taskCompleted)
                              ? TextDecoration.lineThrough
                              : null,
                        ),
                      ),
                      if (subtitle.isNotEmpty)
                        Text(subtitle, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppTheme.getTextSecondary(context), fontSize: 12)),
                    ],
                  ),
                ),
                if (opensNote)
                  Icon(Icons.chevron_right_rounded, color: AppTheme.getTextSecondary(context)),
                if (isMusicCard && musicFilename.isNotEmpty)
                  IconButton.filled(
                    style: IconButton.styleFrom(backgroundColor: color.withValues(alpha: 0.2)),
                    icon: Icon(
                      isThisSongPlaying ? Icons.pause_rounded : Icons.play_arrow_rounded,
                      color: color,
                      size: 20,
                    ),
                    onPressed: () => onPlaySong(musicFilename, title),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
