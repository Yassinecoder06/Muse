import 'dart:async';
import 'package:flutter/material.dart';
import '../../data/models/note.dart';
import '../../data/models/task.dart';
import '../../data/services/api_service.dart';
import '../../data/services/app_events.dart';
import '../theme/app_theme.dart';
import '../widgets/bip_voice_sheet.dart';

class InsightsTab extends StatefulWidget {
  const InsightsTab({super.key});

  @override
  State<InsightsTab> createState() => _InsightsTabState();
}

class _InsightsTabState extends State<InsightsTab> {
  final ApiService _api = ApiService();

  int _selectedRangeDays = 30; // 7, 30, 90, 365
  bool _loading = true;

  List<Note> _notes = [];
  List<TodoTask> _tasks = [];
  Map<String, dynamic> _activity = {};

  @override
  void initState() {
    super.initState();
    _loadInsights();
    AppEvents.dataChanged.addListener(_onDataChanged);
  }

  @override
  void dispose() {
    AppEvents.dataChanged.removeListener(_onDataChanged);
    super.dispose();
  }

  void _onDataChanged() => _loadInsights(silent: true);

  Future<void> _loadInsights({bool silent = false}) async {
    if (!silent) setState(() => _loading = true);

    try {
      final results = await Future.wait([
        _api.fetchNotes(scope: 'all'),
        _api.fetchTasks(),
        _api.fetchAnalyticsActivity(days: _selectedRangeDays),
      ]);

      if (!mounted) return;
      setState(() {
        _notes = results[0] as List<Note>;
        _tasks = results[1] as List<TodoTask>;
        _activity = results[2] as Map<String, dynamic>;
        _loading = false;
      });
    } catch (_) {
      if (mounted && !silent) setState(() => _loading = false);
    }
  }

  int _calculateTotalWords() {
    int total = 0;
    for (final note in _notes) {
      final words = note.content.trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty).length;
      total += words;
    }
    return total;
  }

  Map<String, int> _calculateTagCounts() {
    final counts = <String, int>{};
    for (final note in _notes) {
      for (final tag in note.tags) {
        if (tag.trim().isNotEmpty) {
          counts[tag] = (counts[tag] ?? 0) + 1;
        }
      }
    }
    return counts;
  }

  int _calculateStreak() {
    // Check note update timestamps in past consecutive days
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final daysWithActivity = <String>{};

    for (final note in _notes) {
      final parsed = DateTime.tryParse(note.updatedAt);
      if (parsed != null) {
        final d = DateTime(parsed.year, parsed.month, parsed.day);
        daysWithActivity.add('${d.year}-${d.month}-${d.day}');
      }
    }

    int streak = 0;
    var checkDate = today;
    while (true) {
      final key = '${checkDate.year}-${checkDate.month}-${checkDate.day}';
      if (daysWithActivity.contains(key)) {
        streak++;
        checkDate = checkDate.subtract(const Duration(days: 1));
      } else {
        // If today has no activity yet, check if yesterday had activity to keep streak alive
        if (streak == 0) {
          final yesterday = today.subtract(const Duration(days: 1));
          final yKey = '${yesterday.year}-${yesterday.month}-${yesterday.day}';
          if (daysWithActivity.contains(yKey)) {
            checkDate = yesterday;
            continue;
          }
        }
        break;
      }
    }
    return streak;
  }

  @override
  Widget build(BuildContext context) {
    final totalWords = _calculateTotalWords();
    final streak = _calculateStreak();
    final tagCounts = _calculateTagCounts();
    final completedTasks = _tasks.where((t) => t.completed).length;
    final totalTasks = _tasks.length;
    final taskRate = totalTasks > 0 ? ((completedTasks / totalTasks) * 100).round() : 100;

    final chatsList = _activity['chats'] as List<dynamic>? ?? [];

    return Scaffold(
      backgroundColor: AppTheme.getBackground(context),
      body: RefreshIndicator(
        onRefresh: () => _loadInsights(silent: false),
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // Voice Ask Bip Banner
            InkWell(
              onTap: () => BipVoiceSheet.show(context),
              borderRadius: BorderRadius.circular(14),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFF261E38), Color(0xFF191A26)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: const Color(0xFF00E5FF).withValues(alpha: 0.3)),
                ),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(6),
                      decoration: BoxDecoration(
                        color: const Color(0xFF00E5FF).withValues(alpha: 0.15),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.auto_awesome, color: Color(0xFF00E5FF), size: 16),
                    ),
                    const SizedBox(width: 10),
                    const Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Ask Bip for Insights & Review',
                            style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.bold,
                              color: AppTheme.textPrimary,
                            ),
                          ),
                          Text(
                            'Say "How is my productivity this week?"',
                            style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                          ),
                        ],
                      ),
                    ),
                    const Icon(Icons.arrow_forward_ios_rounded, size: 12, color: AppTheme.textSecondary),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 14),

            // Time Range Tabs
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Overview',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
                ),
                const SizedBox(height: 8),
                SizedBox(
                  width: double.infinity,
                  child: SegmentedButton<int>(
                    showSelectedIcon: false,
                    style: const ButtonStyle(
                      visualDensity: VisualDensity.compact,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                    segments: const [
                      ButtonSegment(value: 7, label: Text('7d')),
                      ButtonSegment(value: 30, label: Text('30d')),
                      ButtonSegment(value: 90, label: Text('90d')),
                      ButtonSegment(value: 365, label: Text('1y')),
                    ],
                    selected: {_selectedRangeDays},
                    onSelectionChanged: (selected) {
                      setState(() => _selectedRangeDays = selected.first);
                      _loadInsights(silent: true);
                    },
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),

            if (_loading)
              const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()))
            else ...[
              // Grid of KPIs
              GridView.count(
                crossAxisCount: 2,
                crossAxisSpacing: 10,
                mainAxisSpacing: 10,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                childAspectRatio: 1.15,
                children: [
                  _buildKpiCard(
                    title: 'Total Notes',
                    value: '${_notes.length}',
                    subtitle: 'in vault',
                    icon: Icons.edit_note_rounded,
                    color: AppTheme.primaryLight,
                  ),
                  _buildKpiCard(
                    title: 'Words Written',
                    value: '$totalWords',
                    subtitle: 'knowledge base',
                    icon: Icons.article_rounded,
                    color: const Color(0xFF00E5FF),
                  ),
                  _buildKpiCard(
                    title: 'Active Streak',
                    value: '$streak day${streak == 1 ? '' : 's'}',
                    subtitle: 'consistency',
                    icon: Icons.local_fire_department_rounded,
                    color: Colors.orangeAccent,
                  ),
                  _buildKpiCard(
                    title: 'Task Health',
                    value: '$taskRate%',
                    subtitle: '$completedTasks of $totalTasks done',
                    icon: Icons.check_circle_rounded,
                    color: Colors.greenAccent,
                  ),
                ],
              ),
              const SizedBox(height: 16),

              // Task Health Breakdown Card
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Expanded(
                            child: Row(
                              children: [
                                Icon(Icons.task_alt_rounded, color: Colors.greenAccent, size: 20),
                                SizedBox(width: 8),
                                Expanded(
                                  child: Text('Task Completion', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: AppTheme.textPrimary)),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 8),
                          Text('$completedTasks / $totalTasks', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppTheme.textSecondary)),
                        ],
                      ),
                      const SizedBox(height: 12),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(6),
                        child: LinearProgressIndicator(
                          value: totalTasks > 0 ? (completedTasks / totalTasks) : 1.0,
                          minHeight: 8,
                          backgroundColor: AppTheme.surfaceBorder,
                          valueColor: const AlwaysStoppedAnimation<Color>(Colors.greenAccent),
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        totalTasks == 0
                            ? 'No tasks created yet. Ask Bip or tap Schedule to add tasks.'
                            : '$completedTasks tasks completed successfully.',
                        style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),

              // Tags Distribution Card
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Row(
                        children: [
                          Icon(Icons.tag_rounded, color: Color(0xFFFF4081), size: 20),
                          SizedBox(width: 8),
                          Text('Tags & Topics', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: AppTheme.textPrimary)),
                        ],
                      ),
                      const SizedBox(height: 12),
                      if (tagCounts.isEmpty)
                        const Text('No tags assigned to notes yet.', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary))
                      else
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: tagCounts.entries.map((entry) {
                            return Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                              decoration: BoxDecoration(
                                color: const Color(0xFFFF4081).withValues(alpha: 0.12),
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(color: const Color(0xFFFF4081).withValues(alpha: 0.3)),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Flexible(
                                    child: Text(
                                      '#${entry.key}',
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFFFF4081)),
                                    ),
                                  ),
                                  const SizedBox(width: 6),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                                    decoration: BoxDecoration(
                                      color: const Color(0xFFFF4081).withValues(alpha: 0.2),
                                      borderRadius: BorderRadius.circular(8),
                                    ),
                                    child: Text(
                                      '${entry.value}',
                                      style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Colors.white),
                                    ),
                                  ),
                                ],
                              ),
                            );
                          }).toList(),
                        ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),

              // Bip AI Interactions Card
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Row(
                        children: [
                          Icon(Icons.smart_toy_rounded, color: Color(0xFF00E5FF), size: 20),
                          SizedBox(width: 8),
                          Text('Bip Activity Log', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: AppTheme.textPrimary)),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text(
                        '${chatsList.length} interactions recorded across devices in the last $_selectedRangeDays days.',
                        style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildKpiCard({
    required String title,
    required String value,
    required String subtitle,
    required IconData icon,
    required Color color,
  }) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary, fontWeight: FontWeight.w500),
                  ),
                ),
                const SizedBox(width: 4),
                Icon(icon, color: color, size: 18),
              ],
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold, color: color),
                ),
                Text(
                  subtitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 10, color: AppTheme.textSecondary),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
