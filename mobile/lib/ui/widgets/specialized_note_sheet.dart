import 'package:flutter/material.dart';
import '../../data/services/api_service.dart';
import '../../data/services/app_events.dart';
import '../theme/app_theme.dart';

class SpecializedNoteSheet extends StatefulWidget {
  const SpecializedNoteSheet({super.key});

  static Future<void> show(BuildContext context) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const SpecializedNoteSheet(),
    );
  }

  @override
  State<SpecializedNoteSheet> createState() => _SpecializedNoteSheetState();
}

class _SpecializedNoteSheetState extends State<SpecializedNoteSheet> {
  final ApiService _api = ApiService();

  String _selectedCategory = 'workout';
  final _titleController = TextEditingController();
  final Map<String, TextEditingController> _fieldControllers = {};
  bool _saving = false;

  final Map<String, Map<String, dynamic>> _templates = {
    'workout': {
      'title': 'Gym Workout',
      'icon': Icons.fitness_center_rounded,
      'color': const Color(0xFF3B82F6),
      'fields': [
        {'id': 'focus', 'label': 'Muscle Group / Focus', 'hint': 'Chest & Triceps, Leg Day...'},
        {'id': 'exercises', 'label': 'Exercises & Sets/Reps', 'hint': 'Bench Press 4x8, Squats 4x10...'},
        {'id': 'notes', 'label': 'Weight & Personal Records', 'hint': 'Felt strong, new PB on bench...'},
      ]
    },
    'daily': {
      'title': 'Daily Plan & Reflection',
      'icon': Icons.today_rounded,
      'color': const Color(0xFFF59E0B),
      'fields': [
        {'id': 'priorities', 'label': 'Top 3 Priorities', 'hint': '1. Ship feature 2. Team call...'},
        {'id': 'wins', 'label': 'Wins & Progress', 'hint': 'Finished layout overhaul...'},
        {'id': 'blockers', 'label': 'Blockers or Lessons', 'hint': 'Need to optimize query...'},
      ]
    },
    'finance': {
      'title': 'Expense & Decision',
      'icon': Icons.account_balance_wallet_rounded,
      'color': const Color(0xFF10B981),
      'fields': [
        {'id': 'amount', 'label': 'Amount & Merchant', 'hint': '\$45 - Groceries & Coffee'},
        {'id': 'category', 'label': 'Budget Category', 'hint': 'Food, Tech, Living...'},
        {'id': 'tradeoff', 'label': 'Decision & Trade-offs', 'hint': 'Was it planned or impulsive?'},
      ]
    },
    'research': {
      'title': 'Research Report',
      'icon': Icons.biotech_rounded,
      'color': const Color(0xFF8B5CF6),
      'fields': [
        {'id': 'topic', 'label': 'Research Topic / Question', 'hint': 'AI inference optimizations...'},
        {'id': 'findings', 'label': 'Key Findings & Evidence', 'hint': 'Direct findings and data...'},
        {'id': 'references', 'label': 'Sources & URLs', 'hint': 'Paper DOI, arXiv, links...'},
      ]
    },
  };

  @override
  void initState() {
    super.initState();
    _initCategoryControllers('workout');
  }

  void _initCategoryControllers(String category) {
    _fieldControllers.clear();
    final fields = _templates[category]?['fields'] as List<dynamic>? ?? [];
    for (final f in fields) {
      final id = f['id'] as String;
      _fieldControllers[id] = TextEditingController();
    }
    _titleController.text = _templates[category]?['title'] as String? ?? 'Specialized Note';
  }

  @override
  void dispose() {
    _titleController.dispose();
    for (final c in _fieldControllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _handleSave() async {
    final title = _titleController.text.trim();
    if (title.isEmpty) return;

    setState(() => _saving = true);
    final fieldMap = <String, String>{};
    _fieldControllers.forEach((k, v) {
      if (v.text.trim().isNotEmpty) {
        fieldMap[k] = v.text.trim();
      }
    });

    try {
      await _api.createSpecializedNote(
        title: title,
        category: _selectedCategory,
        fields: fieldMap,
        tags: [_selectedCategory, 'specialized'],
      );
      AppEvents.notifyDataChanged();
      if (!mounted) return;
      Navigator.of(context).pop();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Created specialized note "$title" ✓')),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to create note: $e'), backgroundColor: Colors.redAccent),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final currentTpl = _templates[_selectedCategory]!;
    final fields = currentTpl['fields'] as List<dynamic>;
    final tplColor = currentTpl['color'] as Color;
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;

    return Container(
      padding: EdgeInsets.fromLTRB(20, 16, 20, 20 + bottomInset),
      decoration: const BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      child: SafeArea(
        top: false,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Drag Handle
              Center(
                child: Container(
                  width: 36,
                  height: 4,
                  margin: const EdgeInsets.only(bottom: 12),
                  decoration: BoxDecoration(
                    color: Colors.white24,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),

              // Title
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Expanded(
                    child: Text(
                      'Create Specialized Note',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                        color: AppTheme.textPrimary,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton(
                    icon: const Icon(Icons.close_rounded, color: AppTheme.textSecondary),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
              const SizedBox(height: 12),

              // Template Selector Chips
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: _templates.keys.map((catKey) {
                    final tpl = _templates[catKey]!;
                    final isSelected = _selectedCategory == catKey;
                    final color = tpl['color'] as Color;
                    final icon = tpl['icon'] as IconData;
                    final title = tpl['title'] as String;

                    return Padding(
                      padding: const EdgeInsets.only(right: 8.0),
                      child: FilterChip(
                        selected: isSelected,
                        avatar: Icon(icon, size: 16, color: isSelected ? Colors.white : color),
                        label: Text(title),
                        labelStyle: TextStyle(
                          fontSize: 12,
                          fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                          color: isSelected ? Colors.white : AppTheme.textPrimary,
                        ),
                        selectedColor: color,
                        backgroundColor: AppTheme.background,
                        side: BorderSide(color: isSelected ? color : AppTheme.surfaceBorder),
                        onSelected: (val) {
                          if (val) {
                            setState(() {
                              _selectedCategory = catKey;
                              _initCategoryControllers(catKey);
                            });
                          }
                        },
                      ),
                    );
                  }).toList(),
                ),
              ),

              const SizedBox(height: 16),

              // Note Title Input
              TextField(
                controller: _titleController,
                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                decoration: InputDecoration(
                  labelText: 'Note Title',
                  prefixIcon: Icon(currentTpl['icon'] as IconData, color: tplColor),
                  filled: true,
                  fillColor: AppTheme.background,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
                ),
              ),

              const SizedBox(height: 14),

              // Structured Fields for this Template
              ...fields.map((f) {
                final id = f['id'] as String;
                final label = f['label'] as String;
                final hint = f['hint'] as String;
                final controller = _fieldControllers[id];

                return Padding(
                  padding: const EdgeInsets.only(bottom: 12.0),
                  child: TextField(
                    controller: controller,
                    maxLines: id == 'exercises' || id == 'findings' ? 3 : 1,
                    style: const TextStyle(fontSize: 14),
                    decoration: InputDecoration(
                      labelText: label,
                      hintText: hint,
                      hintStyle: const TextStyle(color: Colors.white24, fontSize: 13),
                      filled: true,
                      fillColor: AppTheme.background,
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
                    ),
                  ),
                );
              }),

              const SizedBox(height: 14),

              // Submit Button
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: tplColor,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  ),
                  onPressed: _saving ? null : _handleSave,
                  icon: _saving
                      ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Icon(Icons.check_rounded, size: 20),
                  label: Text(
                    _saving ? 'Saving…' : 'Save Specialized Note',
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
