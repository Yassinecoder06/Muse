import 'dart:async';
import 'package:flutter/material.dart';
import '../../data/services/api_service.dart';
import '../../data/services/app_events.dart';
import '../../data/services/tts_service.dart';
import '../../data/services/voice_service.dart';
import '../theme/app_theme.dart';

enum BipVoiceState {
  idle,
  listening,
  thinking,
  speaking,
  success,
  error,
}

class BipVoiceSheet extends StatefulWidget {
  final String? initialPrompt;

  const BipVoiceSheet({super.key, this.initialPrompt});

  static Future<void> show(BuildContext context, {String? initialPrompt}) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => BipVoiceSheet(initialPrompt: initialPrompt),
    );
  }

  @override
  State<BipVoiceSheet> createState() => _BipVoiceSheetState();
}

class _BipVoiceSheetState extends State<BipVoiceSheet> with SingleTickerProviderStateMixin {
  final ApiService _api = ApiService();
  final VoiceService _voice = VoiceService();
  final TtsService _tts = TtsService();

  BipVoiceState _state = BipVoiceState.idle;
  String _spokenText = '';
  String _replyText = '';
  List<Map<String, dynamic>> _actionCards = [];
  String? _errorMessage;
  late AnimationController _animController;
  Timer? _silenceTimer;

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..repeat(reverse: true);

    if (widget.initialPrompt != null && widget.initialPrompt!.isNotEmpty) {
      _spokenText = widget.initialPrompt!;
      _submitPrompt(_spokenText);
    } else {
      _startListening();
    }
  }

  @override
  void dispose() {
    _animController.dispose();
    _silenceTimer?.cancel();
    _voice.stop();
    _tts.stop();
    super.dispose();
  }

  Future<void> _startListening() async {
    await _tts.stop();
    setState(() {
      _state = BipVoiceState.listening;
      _spokenText = '';
      _replyText = '';
      _errorMessage = null;
    });

    final success = await _voice.startDictation(
      onText: (text) {
        if (!mounted) return;
        setState(() => _spokenText = text);
        // Automatically submit after 8 seconds of continuous silence to allow natural pauses
        _silenceTimer?.cancel();
        if (text.trim().isNotEmpty) {
          _silenceTimer = Timer(const Duration(seconds: 8), () {
            if (mounted && _state == BipVoiceState.listening && _spokenText.trim().isNotEmpty) {
              _submitPrompt(_spokenText);
            }
          });
        }
      },
      onError: (err) {
        if (!mounted) return;
        setState(() {
          _state = BipVoiceState.idle;
          _errorMessage = 'Microphone: $err';
        });
      },
      onStopped: () {
        if (mounted && _state == BipVoiceState.listening && _spokenText.isEmpty) {
          setState(() => _state = BipVoiceState.idle);
        }
      },
    );

    if (!success && mounted) {
      setState(() {
        _state = BipVoiceState.idle;
        _errorMessage = 'Microphone not available or permission denied.';
      });
    }
  }

  Future<void> _stopListeningAndSubmit() async {
    _silenceTimer?.cancel();
    await _voice.stop();
    if (_spokenText.trim().isNotEmpty) {
      await _submitPrompt(_spokenText);
    } else {
      setState(() => _state = BipVoiceState.idle);
    }
  }

  Future<void> _submitPrompt(String query) async {
    _silenceTimer?.cancel();
    await _voice.stop();
    setState(() {
      _state = BipVoiceState.thinking;
      _errorMessage = null;
    });

    try {
      final res = await _api.sendChatMessage(query);
      if (!mounted) return;

      final reply = res['reply'] as String? ?? res['content'] as String? ?? '';
      final rawCards = res['actionCards'] as List<dynamic>? ??
          res['action_cards'] as List<dynamic>? ??
          [];
      final cards = rawCards.map((c) => Map<String, dynamic>.from(c as Map)).toList();

      setState(() {
        _replyText = reply;
        _actionCards = cards;
        _state = BipVoiceState.speaking;
      });

      AppEvents.notifyDataChanged();

      // Speak response aloud via TTS
      final autoRead = await _tts.getAutoReadAloud();
      if (autoRead && reply.isNotEmpty) {
        await _tts.speak(
          reply,
          onDone: () {
            if (mounted) setState(() => _state = BipVoiceState.success);
          },
          onError: () {
            if (mounted) setState(() => _state = BipVoiceState.success);
          },
        );
      } else {
        setState(() => _state = BipVoiceState.success);
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _state = BipVoiceState.error;
        _errorMessage = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _handleConfirmAction(String token) async {
    try {
      await _api.confirmAgentAction(token);
      AppEvents.notifyDataChanged();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Action confirmed and executed! ✓')),
      );
      Navigator.of(context).pop();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed: $e'), backgroundColor: Colors.redAccent),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;

    return Container(
      padding: EdgeInsets.fromLTRB(20, 16, 20, 20 + bottomInset),
      decoration: const BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        boxShadow: [
          BoxShadow(color: Colors.black45, blurRadius: 20, spreadRadius: 4),
        ],
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Drag handle
            Container(
              width: 40,
              height: 4,
              margin: const EdgeInsets.only(bottom: 12),
              decoration: BoxDecoration(
                color: Colors.white24,
                borderRadius: BorderRadius.circular(2),
              ),
            ),

            // Top Status Bar
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    _buildStatusBadge(),
                    const SizedBox(width: 8),
                    const Text(
                      'Bip Voice Assistant',
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 16,
                        color: AppTheme.textPrimary,
                      ),
                    ),
                  ],
                ),
                IconButton(
                  icon: const Icon(Icons.close_rounded, color: AppTheme.textSecondary),
                  onPressed: () => Navigator.of(context).pop(),
                  tooltip: 'Close',
                ),
              ],
            ),

            const SizedBox(height: 16),

            // Animated Bip Figure
            _buildBipAvatar(),

            const SizedBox(height: 16),

            // Spoken Dictation Text or Result Display
            _buildContentArea(),

            const SizedBox(height: 16),

            // Action Cards if generated by tools
            if (_actionCards.isNotEmpty) ...[
              _buildActionCardsList(),
              const SizedBox(height: 14),
            ],

            // Bottom Control Buttons
            _buildControls(),
          ],
        ),
      ),
    );
  }

  Widget _buildStatusBadge() {
    Color color;
    String label;
    IconData icon;

    switch (_state) {
      case BipVoiceState.listening:
        color = const Color(0xFF00E5FF);
        label = 'Listening…';
        icon = Icons.mic_rounded;
        break;
      case BipVoiceState.thinking:
        color = const Color(0xFFFFB300);
        label = 'Thinking…';
        icon = Icons.auto_awesome;
        break;
      case BipVoiceState.speaking:
        color = AppTheme.primary;
        label = 'Speaking…';
        icon = Icons.volume_up_rounded;
        break;
      case BipVoiceState.success:
        color = Colors.greenAccent;
        label = 'Done';
        icon = Icons.check_circle_outline;
        break;
      case BipVoiceState.error:
        color = Colors.redAccent;
        label = 'Attention';
        icon = Icons.error_outline;
        break;
      case BipVoiceState.idle:
        color = AppTheme.textSecondary;
        label = 'Ready';
        icon = Icons.smart_toy_rounded;
        break;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.4), width: 1),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: color),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: color),
          ),
        ],
      ),
    );
  }

  Widget _buildBipAvatar() {
    return AnimatedBuilder(
      animation: _animController,
      builder: (context, child) {
        final glowScale = _state == BipVoiceState.listening
            ? 1.0 + (_animController.value * 0.15)
            : (_state == BipVoiceState.thinking ? 1.0 + (_animController.value * 0.08) : 1.0);

        final eyeColor = _state == BipVoiceState.listening
            ? const Color(0xFF00E5FF)
            : (_state == BipVoiceState.thinking
                ? const Color(0xFFFFB300)
                : (_state == BipVoiceState.speaking ? const Color(0xFFB388FF) : const Color(0xFF00E5FF)));

        return Stack(
          alignment: Alignment.center,
          children: [
            // Wave pulse ring during listening
            if (_state == BipVoiceState.listening)
              Container(
                width: 100 * glowScale,
                height: 100 * glowScale,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: const Color(0xFF00E5FF).withValues(alpha: 0.12 * (1.0 - _animController.value)),
                ),
              ),

            // Bip Head Container
            Container(
              width: 76,
              height: 72,
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFF242633), Color(0xFF161720)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: eyeColor.withValues(alpha: 0.6), width: 2),
                boxShadow: [
                  BoxShadow(
                    color: eyeColor.withValues(alpha: 0.3),
                    blurRadius: 14,
                    spreadRadius: 2,
                  ),
                ],
              ),
              child: Stack(
                alignment: Alignment.center,
                children: [
                  // Antenna light
                  Positioned(
                    top: 6,
                    child: Container(
                      width: 6,
                      height: 6,
                      decoration: BoxDecoration(
                        color: eyeColor,
                        shape: BoxShape.circle,
                        boxShadow: [
                          BoxShadow(color: eyeColor, blurRadius: 6, spreadRadius: 1),
                        ],
                      ),
                    ),
                  ),

                  // Digital Eyes
                  Positioned(
                    top: 24,
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        _buildEye(eyeColor),
                        const SizedBox(width: 16),
                        _buildEye(eyeColor),
                      ],
                    ),
                  ),

                  // Mouth / Sound indicator
                  Positioned(
                    bottom: 12,
                    child: _buildMouth(eyeColor),
                  ),
                ],
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _buildEye(Color color) {
    if (_state == BipVoiceState.speaking) {
      // Happy curved arch eye
      return Container(
        width: 12,
        height: 6,
        decoration: BoxDecoration(
          color: color,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(6)),
          boxShadow: [BoxShadow(color: color, blurRadius: 6)],
        ),
      );
    }

    final eyeHeight = _state == BipVoiceState.listening ? 13.0 : 10.0;
    return Container(
      width: 10,
      height: eyeHeight,
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(3),
        boxShadow: [
          BoxShadow(color: color, blurRadius: 6, spreadRadius: 1),
        ],
      ),
    );
  }

  Widget _buildMouth(Color color) {
    if (_state == BipVoiceState.speaking) {
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: List.generate(4, (i) {
          final barH = 4.0 + ((i % 2 == 0 ? _animController.value : (1.0 - _animController.value)) * 8);
          return Container(
            margin: const EdgeInsets.symmetric(horizontal: 1.5),
            width: 3,
            height: barH,
            decoration: BoxDecoration(
              color: color,
              borderRadius: BorderRadius.circular(2),
            ),
          );
        }),
      );
    }

    return Container(
      width: 16,
      height: 3,
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(2),
      ),
    );
  }

  Widget _buildContentArea() {
    if (_errorMessage != null) {
      return Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Colors.redAccent.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: Colors.redAccent.withValues(alpha: 0.3)),
        ),
        child: Row(
          children: [
            const Icon(Icons.error_outline, color: Colors.redAccent, size: 20),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                _errorMessage!,
                style: const TextStyle(color: Colors.redAccent, fontSize: 13),
              ),
            ),
          ],
        ),
      );
    }

    if (_replyText.isNotEmpty) {
      return Container(
        constraints: const BoxConstraints(maxHeight: 180),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppTheme.background,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppTheme.surfaceBorder),
        ),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (_spokenText.isNotEmpty) ...[
                Text(
                  'You: "$_spokenText"',
                  style: const TextStyle(
                    fontSize: 12,
                    fontStyle: FontStyle.italic,
                    color: AppTheme.textSecondary,
                  ),
                ),
                const Divider(height: 16, color: AppTheme.surfaceBorder),
              ],
              Text(
                _replyText,
                style: const TextStyle(
                  fontSize: 14,
                  height: 1.4,
                  color: AppTheme.textPrimary,
                ),
              ),
            ],
          ),
        ),
      );
    }

    // Default: Dictation Transcription Box
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      decoration: BoxDecoration(
        color: AppTheme.background,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: _state == BipVoiceState.listening
              ? const Color(0xFF00E5FF).withValues(alpha: 0.5)
              : AppTheme.surfaceBorder,
        ),
      ),
      child: Column(
        children: [
          Text(
            _spokenText.isEmpty
                ? (_state == BipVoiceState.listening
                    ? 'Listening… Speak your command now.'
                    : 'Tap the microphone and dictate to Bip.')
                : _spokenText,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 15,
              fontWeight: _spokenText.isEmpty ? FontWeight.normal : FontWeight.w500,
              color: _spokenText.isEmpty ? AppTheme.textSecondary : AppTheme.textPrimary,
              height: 1.4,
            ),
          ),

          // Suggestion chips when nothing spoken yet
          if (_spokenText.isEmpty && _state == BipVoiceState.idle) ...[
            const SizedBox(height: 12),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              alignment: WrapAlignment.center,
              children: [
                _buildPromptChip('What are my tasks today?'),
                _buildPromptChip('Remind me tomorrow at 9am'),
                _buildPromptChip('Create a workout note'),
                _buildPromptChip('Download Dua Lipa songs'),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildPromptChip(String prompt) {
    return InkWell(
      onTap: () {
        setState(() => _spokenText = prompt);
        _submitPrompt(prompt);
      },
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: AppTheme.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppTheme.surfaceBorder),
        ),
        child: Text(
          prompt,
          style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary),
        ),
      ),
    );
  }

  Widget _buildActionCardsList() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: _actionCards.map((card) {
        final type = card['type'] as String? ?? 'item';
        final title = card['title'] as String? ?? 'Action Taken';
        final token = card['token'] as String?;

        IconData icon = Icons.check_circle_outline;
        Color color = Colors.greenAccent;

        if (type.contains('task')) {
          icon = Icons.check_box_outlined;
          color = AppTheme.primaryLight;
        } else if (type.contains('note')) {
          icon = Icons.edit_note_rounded;
          color = const Color(0xFF00E5FF);
        } else if (type.contains('music') || type.contains('playlist')) {
          icon = Icons.music_note_rounded;
          color = const Color(0xFFFF4081);
        } else if (type.contains('confirm')) {
          icon = Icons.warning_amber_rounded;
          color = Colors.orangeAccent;
        }

        return Container(
          margin: const EdgeInsets.only(bottom: 8),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: color.withValues(alpha: 0.3)),
          ),
          child: Row(
            children: [
              Icon(icon, color: color, size: 20),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: AppTheme.textPrimary,
                  ),
                ),
              ),
              if (token != null)
                ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.orangeAccent,
                    foregroundColor: Colors.black,
                    visualDensity: VisualDensity.compact,
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  ),
                  onPressed: () => _handleConfirmAction(token),
                  child: const Text('Confirm', style: TextStyle(fontWeight: FontWeight.bold)),
                ),
            ],
          ),
        );
      }).toList(),
    );
  }

  Widget _buildControls() {
    final isListening = _state == BipVoiceState.listening;

    return Row(
      children: [
        if (_replyText.isNotEmpty || _state == BipVoiceState.success) ...[
          Expanded(
            child: OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 14),
                side: const BorderSide(color: AppTheme.surfaceBorder),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              ),
              onPressed: () => Navigator.of(context).pop(),
              icon: const Icon(Icons.check_rounded, color: AppTheme.textPrimary),
              label: const Text('Done', style: TextStyle(color: AppTheme.textPrimary, fontWeight: FontWeight.bold)),
            ),
          ),
          const SizedBox(width: 10),
        ],

        Expanded(
          flex: 2,
          child: ElevatedButton.icon(
            style: ElevatedButton.styleFrom(
              backgroundColor: isListening ? Colors.redAccent : AppTheme.primary,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 14),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              elevation: 4,
            ),
            onPressed: () {
              if (isListening) {
                _stopListeningAndSubmit();
              } else {
                _startListening();
              }
            },
            icon: Icon(isListening ? Icons.stop_rounded : Icons.mic_rounded, size: 20),
            label: Text(
              isListening ? 'Send Voice Command' : 'Dictate to Bip',
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
            ),
          ),
        ),
      ],
    );
  }
}
