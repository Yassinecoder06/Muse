import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:intl/intl.dart';
import '../../data/models/note.dart';
import '../../data/services/api_service.dart';
import '../../data/services/note_cache.dart';
import '../../data/services/note_store.dart';
import '../../data/services/offline_queue.dart';
import '../../data/services/voice_service.dart';
import '../theme/app_theme.dart';

class NoteDetailView extends StatefulWidget {
  final Note note;

  const NoteDetailView({super.key, required this.note});

  @override
  State<NoteDetailView> createState() => _NoteDetailViewState();
}

class _NoteDetailViewState extends State<NoteDetailView> {
  final ApiService _api = ApiService();
  final VoiceService _voice = VoiceService();

  late TextEditingController _titleController;
  late TextEditingController _contentController;
  late bool _favorite;
  late List<String> _tags;

  // Mode: true = Reading (formatted document view), false = Editing (input mode)
  bool _isReadingMode = true;
  bool _saving = false;
  bool _hasChanges = false;
  bool _isDictating = false;
  String _initialDictationText = '';

  // What the editor started with. Saving only sends fields that differ, so
  // opening a rich web note and toggling a tag does not rewrite its HTML body
  // as lossy Markdown.
  late String _savedTitle;
  late String _savedContent;
  late List<String> _savedTags;

  // Latest version known from the server; queued offline edits are checked
  // against it for desktop conflicts when they sync.
  late Note _base;

  // Images in notes are protected, so they load with the device token.
  Map<String, String> _imageHeaders = const {};
  String? _serverBase;

  @override
  void initState() {
    super.initState();
    _titleController = TextEditingController(text: widget.note.title);
    _contentController = TextEditingController(text: widget.note.markdownContent);
    _favorite = widget.note.favorite;
    _tags = List<String>.from(widget.note.tags);
    _base = widget.note;
    _savedTitle = widget.note.title;
    _savedContent = _contentController.text;
    _savedTags = List<String>.from(_tags);

    _titleController.addListener(_onTextChanged);
    _contentController.addListener(_onTextChanged);
    _prepareImages();
  }

  Future<void> _prepareImages() async {
    try {
      final headers = await _api.authHeaders();
      final base = await _api.resolveUrl('/');
      if (mounted) {
        setState(() {
          _imageHeaders = headers;
          _serverBase = base.replaceAll(RegExp(r'/+$'), '');
        });
      }
    } catch (_) {}
  }

  Widget _buildImage(MarkdownImageConfig config) {
    final raw = config.uri.toString();
    Widget fallback() => Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Row(
            children: [
              const Icon(Icons.broken_image_outlined, size: 18, color: AppTheme.textSecondary),
              const SizedBox(width: 6),
              Flexible(child: Text(config.alt?.isNotEmpty == true ? config.alt! : 'Image', style: const TextStyle(color: AppTheme.textSecondary, fontSize: 13))),
            ],
          ),
        );

    Widget image;
    if (raw.startsWith('data:image/')) {
      image = Image.memory(UriData.parse(raw).contentAsBytes(), errorBuilder: (_, _, _) => fallback());
    } else if (raw.startsWith('http://') || raw.startsWith('https://') || _serverBase != null) {
      final url = raw.startsWith('http') ? raw : '$_serverBase${raw.startsWith('/') ? '' : '/'}$raw';
      // Only send the device token to the Muse server itself.
      final headers = _serverBase != null && url.startsWith(_serverBase!) ? _imageHeaders : const <String, String>{};
      image = Image.network(url, headers: headers, errorBuilder: (_, _, _) => fallback());
    } else {
      return fallback();
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: ClipRRect(borderRadius: BorderRadius.circular(12), child: image),
    );
  }

  bool _sameTags(List<String> a, List<String> b) => a.length == b.length && a.every(b.contains);

  // Both the app-bar arrow and Android's back gesture save first, and stay on
  // the page if the save failed so edits are never silently dropped.
  Future<void> _saveAndLeave() async {
    if (_hasChanges) await _saveNote();
    if (mounted && !_hasChanges) Navigator.pop(context, true);
  }

  void _onTextChanged() {
    if (!_hasChanges) {
      setState(() => _hasChanges = true);
    }
  }

  @override
  void dispose() {
    _voice.cancel();
    _titleController.dispose();
    _contentController.dispose();
    super.dispose();
  }

  // Dictation keeps going (across Android's automatic pauses) until the user
  // taps the mic again.
  Future<void> _toggleDictating() async {
    if (_isDictating) {
      await _voice.stop();
      return;
    }
    _initialDictationText = _contentController.text;
    final started = await _voice.startDictation(
      onText: (words) {
        if (!mounted) return;
        setState(() {
          final prefix = _initialDictationText.trim().isEmpty ? '' : '$_initialDictationText\n\n';
          _contentController.text = '$prefix$words';
          _contentController.selection = TextSelection.collapsed(offset: _contentController.text.length);
          _hasChanges = true;
        });
      },
      onError: (err) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Speech error: $err'), backgroundColor: Colors.redAccent));
      },
      onStopped: () {
        if (mounted) setState(() => _isDictating = false);
      },
    );
    if (!mounted) return;
    if (!started) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Microphone access is unavailable or denied. Please grant permission in App Settings.'), backgroundColor: Colors.redAccent),
      );
      return;
    }
    setState(() {
      _isReadingMode = false;
      _isDictating = true;
    });
  }

  Future<void> _saveNote() async {
    final title = _titleController.text.trim();
    final content = _contentController.text;

    setState(() => _saving = true);

    final nextTitle = title.isEmpty ? 'Untitled Note' : title;
    try {
      // Works offline too: the edit is kept on the phone and synced later.
      final saved = await NoteStore.save(
        _api,
        _base,
        title: nextTitle != _savedTitle ? nextTitle : null,
        content: content != _savedContent ? content : null,
        tags: _sameTags(_tags, _savedTags) ? null : _tags,
      );

      setState(() {
        if (saved != null) _base = saved;
        _saving = false;
        _hasChanges = false;
        _savedTitle = nextTitle;
        _savedContent = content;
        _savedTags = List<String>.from(_tags);
      });

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(saved != null ? 'Note saved' : 'Saved on your phone. It will sync when Muse is reachable.'),
            backgroundColor: AppTheme.surface,
            duration: const Duration(seconds: 2),
          ),
        );
      }
    } catch (e) {
      setState(() => _saving = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to save note: $e'),
            backgroundColor: Colors.redAccent,
          ),
        );
      }
    }
  }

  Future<void> _toggleFavorite() async {
    final nextFav = !_favorite;
    // Saved immediately, so it is not an unsaved change.
    setState(() => _favorite = nextFav);

    try {
      final saved = await NoteStore.save(_api, _base, favorite: nextFav);
      if (saved != null && mounted) setState(() => _base = saved);
    } catch (_) {
      if (mounted) setState(() => _favorite = !nextFav);
    }
  }

  Future<void> _confirmDelete() async {
    // A note created offline and never synced is simply discarded.
    final unsynced = _base.isLocal && await NoteCache.serverIdFor(_base.id) == null;
    if (!mounted) return;
    if (unsynced) {
      final discard = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          backgroundColor: AppTheme.surface,
          title: const Text('Discard this note?', style: TextStyle(color: AppTheme.textPrimary)),
          content: const Text('It was created offline and has not synced yet, so it will be gone for good.', style: TextStyle(color: AppTheme.textSecondary)),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel', style: TextStyle(color: AppTheme.textSecondary))),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: Colors.redAccent),
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Discard', style: TextStyle(color: Colors.white)),
            ),
          ],
        ),
      );
      if (discard == true) {
        await OfflineQueue.discardLocalNote(_base.id);
        if (mounted) Navigator.pop(context, true);
      }
      return;
    }

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.surface,
        title: const Text('Move Note to Trash?', style: TextStyle(color: AppTheme.textPrimary)),
        content: const Text(
          'This note will be moved to trash and can be restored from the companion or desktop app.',
          style: TextStyle(color: AppTheme.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel', style: TextStyle(color: AppTheme.textSecondary)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.redAccent),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Move to Trash', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      try {
        final serverId = _base.isLocal ? await NoteCache.serverIdFor(_base.id) ?? _base.id : _base.id;
        await _api.deleteNote(serverId);
        if (mounted) {
          Navigator.pop(context, true);
        }
      } catch (e) {
        if (mounted) {
          final offline = OfflineQueue.isNetworkError(e);
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(offline ? 'Moving to trash needs a connection to Muse. Try again when you are back online.' : 'Failed to delete note: $e'),
              backgroundColor: Colors.redAccent,
            ),
          );
        }
      }
    }
  }

  void _showAddTagDialog() {
    final tagCtrl = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.surface,
        title: const Text('Add Tag', style: TextStyle(color: AppTheme.textPrimary)),
        content: TextField(
          controller: tagCtrl,
          autofocus: true,
          style: const TextStyle(color: AppTheme.textPrimary),
          decoration: const InputDecoration(
            hintText: 'e.g. gym, ideas, planning',
            hintStyle: TextStyle(color: AppTheme.textSecondary),
          ),
          onSubmitted: (val) {
            final t = val.trim().replaceAll('#', '');
            if (t.isNotEmpty && !_tags.contains(t)) {
              setState(() {
                _tags.add(t);
                _hasChanges = true;
              });
            }
            Navigator.pop(ctx);
          },
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel', style: TextStyle(color: AppTheme.textSecondary)),
          ),
          ElevatedButton(
            onPressed: () {
              final t = tagCtrl.text.trim().replaceAll('#', '');
              if (t.isNotEmpty && !_tags.contains(t)) {
                setState(() {
                  _tags.add(t);
                  _hasChanges = true;
                });
              }
              Navigator.pop(ctx);
            },
            child: const Text('Add'),
          ),
        ],
      ),
    );
  }

  String _formatDate(String isoString) {
    if (isoString.isEmpty) return '';
    try {
      final dt = DateTime.parse(isoString).toLocal();
      return DateFormat('MMM d, yyyy · h:mm a').format(dt);
    } catch (_) {
      return isoString;
    }
  }

  int _countWords(String text) {
    if (text.trim().isEmpty) return 0;
    return text.trim().split(RegExp(r'\s+')).length;
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: !_hasChanges,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _saveAndLeave();
      },
      child: _buildPage(context),
    );
  }

  Widget _buildPage(BuildContext context) {
    final formattedDate = _formatDate(widget.note.updatedAt);
    final wordCount = _countWords(_contentController.text);

    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        backgroundColor: AppTheme.surface,
        titleSpacing: 0,
        // The Read/Edit switch shrinks to fit next to the action icons.
        title: FittedBox(
          fit: BoxFit.scaleDown,
          alignment: Alignment.centerLeft,
          child: Row(
          children: [
            // Mode toggle button (Read vs Edit)
            Container(
              decoration: BoxDecoration(
                color: AppTheme.background,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppTheme.surfaceBorder),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  GestureDetector(
                    onTap: () => setState(() => _isReadingMode = true),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                      decoration: BoxDecoration(
                        color: _isReadingMode ? AppTheme.primary : Colors.transparent,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Row(
                        children: [
                          Icon(Icons.menu_book_rounded, size: 14, color: _isReadingMode ? Colors.white : AppTheme.textSecondary),
                          const SizedBox(width: 4),
                          Text(
                            'Read',
                            style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: _isReadingMode ? Colors.white : AppTheme.textSecondary),
                          ),
                        ],
                      ),
                    ),
                  ),
                  GestureDetector(
                    onTap: () => setState(() => _isReadingMode = false),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                      decoration: BoxDecoration(
                        color: !_isReadingMode ? AppTheme.primary : Colors.transparent,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Row(
                        children: [
                          Icon(Icons.edit_rounded, size: 14, color: !_isReadingMode ? Colors.white : AppTheme.textSecondary),
                          const SizedBox(width: 4),
                          Text(
                            'Edit',
                            style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: !_isReadingMode ? Colors.white : AppTheme.textSecondary),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        ),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          onPressed: _saveAndLeave,
        ),
        actions: [
          IconButton(
            tooltip: _isDictating ? 'Stop dictating' : 'Dictate with microphone',
            icon: Icon(
              _isDictating ? Icons.mic_rounded : Icons.mic_none_rounded,
              color: _isDictating ? Colors.redAccent : AppTheme.textSecondary,
            ),
            onPressed: _toggleDictating,
          ),
          IconButton(
            tooltip: _favorite ? 'Favorited' : 'Favorite',
            icon: Icon(
              _favorite ? Icons.star_rounded : Icons.star_outline_rounded,
              color: _favorite ? Colors.amber : AppTheme.textSecondary,
            ),
            onPressed: _toggleFavorite,
          ),
          IconButton(
            tooltip: 'Move to Trash',
            icon: const Icon(Icons.delete_outline_rounded, color: AppTheme.textSecondary),
            onPressed: _confirmDelete,
          ),
          if (_saving)
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 14.0),
              child: SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.primaryLight),
              ),
            )
          else if (!_isReadingMode || _hasChanges)
            IconButton(
              tooltip: 'Save',
              onPressed: _hasChanges ? _saveNote : null,
              icon: Icon(
                Icons.check_circle_rounded,
                color: _hasChanges ? AppTheme.accent : AppTheme.textSecondary.withValues(alpha: 0.3),
              ),
            ),
          const SizedBox(width: 4),
        ],
      ),
      floatingActionButton: _isReadingMode
          ? FloatingActionButton.extended(
              onPressed: () => setState(() => _isReadingMode = false),
              icon: const Icon(Icons.edit_rounded),
              label: const Text('Edit Note', style: TextStyle(fontWeight: FontWeight.bold)),
            )
          : null,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (_isDictating)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  margin: const EdgeInsets.only(bottom: 12),
                  decoration: BoxDecoration(
                    color: Colors.redAccent.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(10),
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
                        'Dictating into note... Speak now',
                        style: TextStyle(color: Colors.redAccent, fontSize: 13, fontWeight: FontWeight.bold),
                      ),
                      const Spacer(),
                      GestureDetector(
                        onTap: _toggleDictating,
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
              // Kind badge pill
              if (widget.note.kind == 'research' || widget.note.kind == 'specialized')
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: widget.note.kind == 'research'
                          ? const Color(0xFF8B5CF6).withValues(alpha: 0.18)
                          : const Color(0xFF10B981).withValues(alpha: 0.18),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: widget.note.kind == 'research' ? const Color(0xFFA78BFA) : const Color(0xFF34D399),
                      ),
                    ),
                    child: Text(
                      widget.note.kind == 'research' ? '🔬 RESEARCH NOTE' : '⚡ SPECIALIZED NOTE',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        color: widget.note.kind == 'research' ? const Color(0xFFA78BFA) : const Color(0xFF34D399),
                        letterSpacing: 0.5,
                      ),
                    ),
                  ),
                ),

              // Title Section
              if (_isReadingMode)
                Text(
                  _titleController.text.isEmpty ? 'Untitled note' : _titleController.text,
                  style: const TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.bold,
                    color: AppTheme.textPrimary,
                    height: 1.25,
                  ),
                )
              else
                TextField(
                  controller: _titleController,
                  style: const TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.bold,
                    color: AppTheme.textPrimary,
                    height: 1.25,
                  ),
                  maxLines: null,
                  decoration: const InputDecoration(
                    hintText: 'Note Title',
                    hintStyle: TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.bold,
                      color: AppTheme.textSecondary,
                    ),
                    border: InputBorder.none,
                    contentPadding: EdgeInsets.zero,
                  ),
                ),
              const SizedBox(height: 10),

              // Metadata info row (date, word count)
              Wrap(
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  if (formattedDate.isNotEmpty)
                    Text(
                      'Edited $formattedDate',
                      style: TextStyle(fontSize: 12, color: AppTheme.textSecondary.withValues(alpha: 0.8)),
                    ),
                  if (wordCount > 0) ...[
                    const SizedBox(width: 10),
                    Text(
                      '•  $wordCount words',
                      style: TextStyle(fontSize: 12, color: AppTheme.textSecondary.withValues(alpha: 0.8)),
                    ),
                  ],
                ],
              ),
              const SizedBox(height: 14),

              // Tags Row
              Wrap(
                spacing: 8,
                runSpacing: 6,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  ..._tags.map(
                    (tag) => Chip(
                      label: Text('#$tag', style: const TextStyle(fontSize: 12, color: AppTheme.primaryLight, fontWeight: FontWeight.w500)),
                      backgroundColor: AppTheme.surface,
                      side: const BorderSide(color: AppTheme.surfaceBorder),
                      padding: const EdgeInsets.symmetric(horizontal: 4),
                      deleteIcon: !_isReadingMode ? const Icon(Icons.close_rounded, size: 14, color: AppTheme.textSecondary) : null,
                      onDeleted: !_isReadingMode
                          ? () {
                              setState(() {
                                _tags.remove(tag);
                                _hasChanges = true;
                              });
                            }
                          : null,
                    ),
                  ),
                  if (!_isReadingMode)
                    ActionChip(
                      avatar: const Icon(Icons.add, size: 14, color: AppTheme.textSecondary),
                      label: const Text('Tag', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                      backgroundColor: AppTheme.surface,
                      side: const BorderSide(color: AppTheme.surfaceBorder),
                      onPressed: _showAddTagDialog,
                    ),
                ],
              ),

              // AI Summary (if available)
              if (widget.note.summary != null && widget.note.summary!.isNotEmpty) ...[
                const SizedBox(height: 16),
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: AppTheme.primary.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: AppTheme.primaryLight.withValues(alpha: 0.3)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Row(
                        children: [
                          Icon(Icons.auto_awesome, size: 16, color: AppTheme.primaryLight),
                          SizedBox(width: 8),
                          Text('AI Summary', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppTheme.primaryLight)),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text(
                        widget.note.summary!,
                        style: const TextStyle(fontSize: 13, color: AppTheme.textPrimary, height: 1.45),
                      ),
                    ],
                  ),
                ),
              ],

              const SizedBox(height: 18),
              const Divider(color: AppTheme.surfaceBorder, height: 1),
              const SizedBox(height: 18),

              // Document Body
              if (_isReadingMode)
                // Crystal Clear Markdown View with formatted headings, tables, bullet points
                MarkdownBody(
                  data: _contentController.text.isNotEmpty
                      ? _contentController.text
                      : '*No content written yet. Tap "Edit" to write.*',
                  selectable: true,
                  sizedImageBuilder: _buildImage,
                  styleSheet: MarkdownStyleSheet(
                    h1: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: AppTheme.textPrimary, height: 1.4),
                    h2: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.textPrimary, height: 1.4),
                    h3: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.textPrimary, height: 1.3),
                    p: const TextStyle(fontSize: 15, color: AppTheme.textPrimary, height: 1.6),
                    strong: const TextStyle(fontWeight: FontWeight.bold, color: Colors.white),
                    em: const TextStyle(fontStyle: FontStyle.italic, color: AppTheme.textPrimary),
                    blockquote: const TextStyle(color: AppTheme.textSecondary, fontSize: 14, fontStyle: FontStyle.italic),
                    blockquoteDecoration: const BoxDecoration(
                      border: Border(left: BorderSide(color: AppTheme.primaryLight, width: 3)),
                    ),
                    tableBorder: TableBorder.all(color: AppTheme.surfaceBorder, width: 1),
                    tableHead: const TextStyle(fontWeight: FontWeight.bold, color: AppTheme.primaryLight, fontSize: 13),
                    tableBody: const TextStyle(color: AppTheme.textPrimary, fontSize: 13),
                    tableCellsPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                    listBullet: const TextStyle(color: AppTheme.primaryLight, fontSize: 15),
                    horizontalRuleDecoration: const BoxDecoration(
                      border: Border(top: BorderSide(color: AppTheme.surfaceBorder, width: 1)),
                    ),
                    code: const TextStyle(
                      backgroundColor: AppTheme.surface,
                      color: AppTheme.accent,
                      fontFamily: 'monospace',
                      fontSize: 13,
                    ),
                  ),
                )
              else
                // Editor Input
                TextField(
                  controller: _contentController,
                  style: const TextStyle(
                    fontSize: 15,
                    color: AppTheme.textPrimary,
                    height: 1.6,
                  ),
                  maxLines: null,
                  keyboardType: TextInputType.multiline,
                  decoration: const InputDecoration(
                    hintText: 'Start writing your note or thoughts here…',
                    hintStyle: TextStyle(color: AppTheme.textSecondary, fontSize: 15),
                    border: InputBorder.none,
                    contentPadding: EdgeInsets.zero,
                  ),
                ),
              const SizedBox(height: 100),
            ],
          ),
        ),
      ),
    );
  }
}
