import 'package:flutter/material.dart';
import '../../data/models/task.dart';
import '../../data/services/api_service.dart';
import '../theme/app_theme.dart';

class TasksTab extends StatefulWidget {
  const TasksTab({super.key});

  @override
  State<TasksTab> createState() => _TasksTabState();
}

class _TasksTabState extends State<TasksTab> {
  final ApiService _api = ApiService();
  List<TodoTask> _tasks = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadTasks();
  }

  Future<void> _loadTasks() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final list = await _api.fetchTasks();
      setState(() {
        _tasks = list;
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  Future<void> _toggleTask(TodoTask task) async {
    final nextStatus = !task.completed;
    setState(() {
      final index = _tasks.indexWhere((t) => t.id == task.id);
      if (index != -1) {
        _tasks[index] = task.copyWith(completed: nextStatus);
      }
    });

    try {
      await _api.toggleTaskCompleted(task.id, nextStatus);
    } catch (_) {
      // Revert if error
      setState(() {
        final index = _tasks.indexWhere((t) => t.id == task.id);
        if (index != -1) {
          _tasks[index] = task.copyWith(completed: !nextStatus);
        }
      });
    }
  }

  void _showAddTaskDialog() {
    final titleController = TextEditingController();

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
          left: 20,
          right: 20,
          top: 20,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'Add New Task',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
                ),
                IconButton(
                  icon: const Icon(Icons.close, color: AppTheme.textSecondary),
                  onPressed: () => Navigator.pop(ctx),
                ),
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: titleController,
              autofocus: true,
              style: const TextStyle(color: AppTheme.textPrimary),
              decoration: InputDecoration(
                hintText: 'What needs to be done?',
                hintStyle: const TextStyle(color: AppTheme.textSecondary),
                filled: true,
                fillColor: AppTheme.background,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
              ),
              onSubmitted: (_) => _submitTask(ctx, titleController.text),
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.primary,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              onPressed: () => _submitTask(ctx, titleController.text),
              child: const Text('Add Task', style: TextStyle(fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _submitTask(BuildContext ctx, String text) async {
    final title = text.trim();
    if (title.isEmpty) return;
    Navigator.pop(ctx);
    try {
      await _api.createTask(title: title);
      _loadTasks();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to add task: $e')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final pending = _tasks.where((t) => !t.completed).toList();
    final completed = _tasks.where((t) => t.completed).toList();

    return Scaffold(
      backgroundColor: AppTheme.background,
      floatingActionButton: FloatingActionButton(
        onPressed: _showAddTaskDialog,
        tooltip: 'New Task',
        child: const Icon(Icons.add_task_rounded),
      ),
      body: RefreshIndicator(
        onRefresh: _loadTasks,
        color: AppTheme.primaryLight,
        child: _loading
            ? const Center(child: CircularProgressIndicator(color: AppTheme.primaryLight))
            : _error != null
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24.0),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.cloud_off_rounded, color: Colors.orangeAccent, size: 48),
                          const SizedBox(height: 12),
                          Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: AppTheme.textSecondary)),
                          const SizedBox(height: 16),
                          ElevatedButton.icon(
                            onPressed: _loadTasks,
                            icon: const Icon(Icons.refresh),
                            label: const Text('Retry'),
                          ),
                        ],
                      ),
                    ),
                  )
                : _tasks.isEmpty
                    ? Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.check_circle_outline_rounded, size: 48, color: AppTheme.textSecondary.withValues(alpha: 0.4)),
                            const SizedBox(height: 12),
                            const Text('No tasks yet. Enjoy your day!', style: TextStyle(color: AppTheme.textSecondary)),
                          ],
                        ),
                      )
                    : ListView(
                        padding: const EdgeInsets.fromLTRB(16, 16, 16, 80),
                        children: [
                          if (pending.isNotEmpty) ...[
                            _buildSectionHeader('TO DO (${pending.length})'),
                            const SizedBox(height: 8),
                            ...pending.map(_buildTaskTile),
                            const SizedBox(height: 16),
                          ],
                          if (completed.isNotEmpty) ...[
                            _buildSectionHeader('COMPLETED (${completed.length})'),
                            const SizedBox(height: 8),
                            ...completed.map(_buildTaskTile),
                          ],
                        ],
                      ),
      ),
    );
  }

  Widget _buildSectionHeader(String title) {
    return Text(
      title,
      style: const TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.bold,
        color: AppTheme.textSecondary,
        letterSpacing: 1,
      ),
    );
  }

  Widget _buildTaskTile(TodoTask task) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: IconButton(
          icon: Icon(
            task.completed ? Icons.check_circle_rounded : Icons.radio_button_unchecked_rounded,
            color: task.completed ? AppTheme.accent : AppTheme.textSecondary,
          ),
          onPressed: () => _toggleTask(task),
        ),
        title: Text(
          task.title,
          style: TextStyle(
            color: task.completed ? AppTheme.textSecondary : AppTheme.textPrimary,
            decoration: task.completed ? TextDecoration.lineThrough : null,
            fontSize: 15,
          ),
        ),
      ),
    );
  }
}
