import 'package:flutter/material.dart';
import '../../data/services/api_service.dart';
import '../theme/app_theme.dart';

class BipMemoriesSheet extends StatefulWidget {
  const BipMemoriesSheet({super.key});

  static Future<void> show(BuildContext context) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const BipMemoriesSheet(),
    );
  }

  @override
  State<BipMemoriesSheet> createState() => _BipMemoriesSheetState();
}

class _BipMemoriesSheetState extends State<BipMemoriesSheet> {
  final ApiService _api = ApiService();
  List<Map<String, dynamic>> _memories = [];
  bool _loading = true;
  String? _error;
  final TextEditingController _factController = TextEditingController();
  bool _isSaving = false;

  @override
  void initState() {
    super.initState();
    _loadMemories();
  }

  @override
  void dispose() {
    _factController.dispose();
    super.dispose();
  }

  Future<void> _loadMemories() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final list = await _api.fetchMemories();
      if (!mounted) return;
      setState(() {
        _memories = list;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  Future<void> _addMemory() async {
    final text = _factController.text.trim();
    if (text.isEmpty || _isSaving) return;

    setState(() => _isSaving = true);
    try {
      final created = await _api.createMemory(text);
      if (!mounted) return;
      _factController.clear();
      setState(() {
        _memories.insert(0, created);
        _isSaving = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to save memory: $e'), backgroundColor: Colors.redAccent),
      );
    }
  }

  Future<void> _deleteMemory(String id) async {
    try {
      await _api.deleteMemory(id);
      if (!mounted) return;
      setState(() {
        _memories.removeWhere((m) => m['id']?.toString() == id);
      });
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to delete: $e'), backgroundColor: Colors.redAccent),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;

    return Container(
      height: MediaQuery.of(context).size.height * 0.75,
      margin: EdgeInsets.only(bottom: bottomInset),
      decoration: BoxDecoration(
        color: AppTheme.getSurface(context),
        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
        border: Border.all(color: AppTheme.getSurfaceBorder(context)),
      ),
      child: Column(
        children: [
          // Drag handle & Header
          Center(
            child: Container(
              margin: const EdgeInsets.only(top: 10, bottom: 6),
              width: 36,
              height: 4,
              decoration: BoxDecoration(
                color: AppTheme.getTextSecondary(context).withValues(alpha: 0.3),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: Colors.amberAccent.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(Icons.psychology_outlined, color: Colors.amberAccent, size: 20),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Bip Memories',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                          color: AppTheme.getTextPrimary(context),
                        ),
                      ),
                      Text(
                        'Facts and preferences Bip remembers about you',
                        style: TextStyle(
                          fontSize: 12,
                          color: AppTheme.getTextSecondary(context),
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close_rounded),
                  color: AppTheme.getTextSecondary(context),
                  onPressed: () => Navigator.pop(context),
                ),
              ],
            ),
          ),
          const Divider(height: 1),

          // Add memory row
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _factController,
                    style: TextStyle(color: AppTheme.getTextPrimary(context), fontSize: 13),
                    decoration: InputDecoration(
                      hintText: 'Teach Bip something (e.g. "I love sci-fi novels")',
                      hintStyle: TextStyle(color: AppTheme.getTextSecondary(context), fontSize: 12),
                      filled: true,
                      fillColor: isDark ? const Color(0xFF161616) : const Color(0xFFF1F3F5),
                      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10),
                        borderSide: BorderSide(color: AppTheme.getSurfaceBorder(context)),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10),
                        borderSide: BorderSide(color: AppTheme.getSurfaceBorder(context)),
                      ),
                    ),
                    onSubmitted: (_) => _addMemory(),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton.filled(
                  style: IconButton.styleFrom(backgroundColor: AppTheme.primaryLight),
                  icon: _isSaving
                      ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black))
                      : const Icon(Icons.add_rounded, color: Colors.black, size: 20),
                  onPressed: _addMemory,
                ),
              ],
            ),
          ),

          // Memories list
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                    ? Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(_error!, style: const TextStyle(color: Colors.redAccent, fontSize: 13)),
                            const SizedBox(height: 8),
                            TextButton(onPressed: _loadMemories, child: const Text('Retry')),
                          ],
                        ),
                      )
                    : _memories.isEmpty
                        ? Center(
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(Icons.psychology_outlined, size: 48, color: AppTheme.getTextSecondary(context).withValues(alpha: 0.4)),
                                const SizedBox(height: 12),
                                Text(
                                  'No memories saved yet',
                                  style: TextStyle(color: AppTheme.getTextPrimary(context), fontSize: 14, fontWeight: FontWeight.w600),
                                ),
                                const SizedBox(height: 4),
                                Padding(
                                  padding: const EdgeInsets.symmetric(horizontal: 32),
                                  child: Text(
                                    'Bip automatically remembers facts from your chats, or you can add one above.',
                                    textAlign: TextAlign.center,
                                    style: TextStyle(color: AppTheme.getTextSecondary(context), fontSize: 12),
                                  ),
                                ),
                              ],
                            ),
                          )
                        : ListView.separated(
                            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                            itemCount: _memories.length,
                            separatorBuilder: (_, _) => const SizedBox(height: 8),
                            itemBuilder: (context, index) {
                              final mem = _memories[index];
                              final id = mem['id']?.toString() ?? '';
                              final fact = mem['fact']?.toString() ?? '';
                              final category = mem['category']?.toString() ?? 'general';

                              return Container(
                                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                                decoration: BoxDecoration(
                                  color: isDark ? const Color(0xFF141414) : const Color(0xFFF8F9FA),
                                  borderRadius: BorderRadius.circular(12),
                                  border: Border.all(color: AppTheme.getSurfaceBorder(context)),
                                ),
                                child: Row(
                                  children: [
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                      decoration: BoxDecoration(
                                        color: Colors.amberAccent.withValues(alpha: 0.15),
                                        borderRadius: BorderRadius.circular(6),
                                      ),
                                      child: Text(
                                        category.toUpperCase(),
                                        style: const TextStyle(fontSize: 9, fontWeight: FontWeight.bold, color: Colors.amberAccent),
                                      ),
                                    ),
                                    const SizedBox(width: 10),
                                    Expanded(
                                      child: Text(
                                        fact,
                                        style: TextStyle(
                                          fontSize: 13,
                                          color: AppTheme.getTextPrimary(context),
                                          height: 1.3,
                                        ),
                                      ),
                                    ),
                                    IconButton(
                                      icon: const Icon(Icons.delete_outline_rounded, size: 18),
                                      color: Colors.redAccent.withValues(alpha: 0.8),
                                      onPressed: () => _deleteMemory(id),
                                    ),
                                  ],
                                ),
                              );
                            },
                          ),
          ),
        ],
      ),
    );
  }
}
