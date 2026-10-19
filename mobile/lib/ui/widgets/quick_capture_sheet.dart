import 'dart:io';
import 'package:flutter/material.dart';
import '../../data/services/api_service.dart';
import '../../data/services/offline_queue.dart';
import '../../data/services/voice_service.dart';
import '../theme/app_theme.dart';

const _maxImageBytes = 5 * 1024 * 1024;

/// One sheet for every fast way into Muse: the home-screen shortcuts, text or
/// images shared from other apps, and voice notes. Saves work offline too.
Future<void> showQuickCapture(
  BuildContext context, {
  String initialText = '',
  String? imagePath,
  String? imageMime,
  bool startDictation = false,
}) {
  return showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppTheme.surface,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (_) => _QuickCaptureSheet(
      initialText: initialText,
      imagePath: imagePath,
      imageMime: imageMime,
      startDictation: startDictation,
    ),
  );
}

class _QuickCaptureSheet extends StatefulWidget {
  final String initialText;
  final String? imagePath;
  final String? imageMime;
  final bool startDictation;

  const _QuickCaptureSheet({required this.initialText, this.imagePath, this.imageMime, this.startDictation = false});

  @override
  State<_QuickCaptureSheet> createState() => _QuickCaptureSheetState();
}

class _QuickCaptureSheetState extends State<_QuickCaptureSheet> {
  final _api = ApiService();
  final _voice = VoiceService();
  final _title = TextEditingController();
  late final TextEditingController _content;
  bool _asTask = false;
  bool _saving = false;
  bool _listening = false;
  String _beforeDictation = '';

  @override
  void initState() {
    super.initState();
    _content = TextEditingController(text: widget.initialText);
    if (widget.startDictation) WidgetsBinding.instance.addPostFrameCallback((_) => _toggleDictation());
  }

  @override
  void dispose() {
    _voice.cancelListening();
    _title.dispose();
    _content.dispose();
    super.dispose();
  }

  Future<void> _toggleDictation() async {
    if (_listening) {
      await _voice.stopListening();
      if (mounted) setState(() => _listening = false);
      return;
    }
    final ok = await _voice.initialize(
      onError: (_) {
        if (mounted) setState(() => _listening = false);
      },
      onStatus: (status) {
        if ((status == 'done' || status == 'notListening') && mounted) setState(() => _listening = false);
      },
    );
    if (!ok) {
      _toast('Microphone is unavailable. Allow it in system settings.');
      return;
    }
    _beforeDictation = _content.text.trim();
    setState(() => _listening = true);
    await _voice.startListening(
      onResult: (words, isFinal) {
        if (!mounted) return;
        setState(() {
          _content.text = _beforeDictation.isEmpty ? words : '$_beforeDictation $words';
          _content.selection = TextSelection.collapsed(offset: _content.text.length);
          if (isFinal) _listening = false;
        });
      },
    );
  }

  void _toast(String message, {bool error = false}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), backgroundColor: error ? Colors.redAccent : null),
    );
  }

  String _derivedTitle(String content) {
    final firstLine = content.split('\n').map((line) => line.trim()).firstWhere((line) => line.isNotEmpty, orElse: () => '');
    if (firstLine.isEmpty) return widget.imagePath != null ? 'Shared image' : 'Quick note';
    return firstLine.length > 60 ? '${firstLine.substring(0, 57)}…' : firstLine;
  }

  Future<void> _save() async {
    final content = _content.text.trim();
    final typedTitle = _title.text.trim();
    if (content.isEmpty && typedTitle.isEmpty && widget.imagePath == null) return;
    setState(() => _saving = true);
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);

    try {
      bool savedNow;
      if (_asTask) {
        savedNow = await OfflineQueue.createTask(_api, title: typedTitle.isNotEmpty ? typedTitle : _derivedTitle(content));
      } else {
        var body = content;
        if (widget.imagePath != null) {
          // Images need the server right away; they are not queued offline.
          final bytes = await File(widget.imagePath!).readAsBytes();
          if (bytes.length > _maxImageBytes) throw Exception('That image is larger than 5 MB.');
          final url = await _api.uploadImage(bytes, widget.imageMime ?? 'image/jpeg');
          body = '${body.isEmpty ? '' : '$body\n\n'}![]($url)';
        }
        savedNow = await OfflineQueue.createNote(
          _api,
          title: typedTitle.isNotEmpty ? typedTitle : _derivedTitle(content),
          content: body,
          tags: const ['mobile'],
        );
      }
      navigator.pop();
      messenger.showSnackBar(SnackBar(
        content: Text(savedNow
            ? (_asTask ? 'Task added to Muse' : 'Saved to Muse')
            : 'Saved on your phone. It will sync when Muse is reachable.'),
      ));
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      final offlineImage = widget.imagePath != null && OfflineQueue.isNetworkError(e);
      _toast(offlineImage ? 'Muse is unreachable. Images need a connection to upload.' : e.toString().replaceFirst('Exception: ', ''), error: true);
    }
  }

  InputDecoration _field(String hint) => InputDecoration(
        hintText: hint,
        hintStyle: const TextStyle(color: AppTheme.textSecondary),
        filled: true,
        fillColor: AppTheme.background,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
      );

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom + 20, left: 20, right: 20, top: 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Icon(Icons.bolt_rounded, color: AppTheme.primaryLight),
              const SizedBox(width: 8),
              const Text('Quick capture', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
              const Spacer(),
              if (widget.imagePath == null)
                SegmentedButton<bool>(
                  showSelectedIcon: false,
                  style: const ButtonStyle(visualDensity: VisualDensity.compact),
                  segments: const [
                    ButtonSegment(value: false, label: Text('Note')),
                    ButtonSegment(value: true, label: Text('Task')),
                  ],
                  selected: {_asTask},
                  onSelectionChanged: (value) => setState(() => _asTask = value.first),
                ),
            ],
          ),
          const SizedBox(height: 12),
          if (!_asTask) ...[
            TextField(controller: _title, style: const TextStyle(color: AppTheme.textPrimary, fontWeight: FontWeight.w600), decoration: _field('Title (optional)')),
            const SizedBox(height: 10),
          ],
          if (widget.imagePath != null) ...[
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: Image.file(File(widget.imagePath!), height: 160, fit: BoxFit.cover),
            ),
            const SizedBox(height: 10),
          ],
          TextField(
            controller: _content,
            autofocus: !widget.startDictation,
            minLines: _asTask ? 1 : 3,
            maxLines: _asTask ? 2 : 8,
            style: const TextStyle(color: AppTheme.textPrimary),
            decoration: _field(_listening ? 'Listening…' : (_asTask ? 'What needs to be done?' : 'Type, paste, or tap the mic…')).copyWith(
              suffixIcon: IconButton(
                tooltip: _listening ? 'Stop dictation' : 'Dictate',
                icon: Icon(_listening ? Icons.mic_rounded : Icons.mic_none_rounded, color: _listening ? Colors.redAccent : AppTheme.textSecondary),
                onPressed: _toggleDictation,
              ),
            ),
          ),
          const SizedBox(height: 16),
          ElevatedButton.icon(
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.primary,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 14),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            onPressed: _saving ? null : _save,
            icon: _saving
                ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : Icon(_asTask ? Icons.add_task_rounded : Icons.check_rounded),
            label: Text(_asTask ? 'Add task' : 'Save note', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
          ),
        ],
      ),
    );
  }
}
