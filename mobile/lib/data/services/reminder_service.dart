import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;
import '../models/event.dart';
import '../models/task.dart';
import 'device_timezone.dart';

/// Local notifications for upcoming tasks and events. Rebuilt from the latest
/// lists every time the Tasks tab loads, so edits on desktop are picked up.
class ReminderService {
  ReminderService._();

  static final _plugin = FlutterLocalNotificationsPlugin();
  static const _enabledKey = 'muse_reminders_enabled';
  static const _horizon = Duration(days: 14);
  static const _maxScheduled = 60;
  static bool _ready = false;

  static const _details = NotificationDetails(
    android: AndroidNotificationDetails(
      'muse_reminders',
      'Reminders',
      channelDescription: 'Upcoming tasks and calendar events from Muse',
      importance: Importance.high,
      priority: Priority.high,
    ),
    iOS: DarwinNotificationDetails(),
  );

  static Future<void> init() async {
    try {
      tzdata.initializeTimeZones();
      final zone = DeviceTimezone.id;
      try {
        tz.setLocalLocation(tz.getLocation(zone ?? 'UTC'));
      } catch (_) {
        tz.setLocalLocation(tz.UTC);
      }
      await _plugin.initialize(
        settings: const InitializationSettings(
          android: AndroidInitializationSettings('@mipmap/ic_launcher'),
          iOS: DarwinInitializationSettings(requestAlertPermission: false, requestBadgePermission: false, requestSoundPermission: false),
        ),
      );
      _ready = true;
    } catch (e) {
      debugPrint('[Reminders] unavailable: $e');
    }
  }

  static Future<bool> isEnabled() async => (await SharedPreferences.getInstance()).getBool(_enabledKey) ?? false;

  /// Turning reminders on asks for notification permission; returns whether
  /// they ended up enabled.
  static Future<bool> setEnabled(bool enabled) async {
    final prefs = await SharedPreferences.getInstance();
    if (!enabled) {
      await prefs.setBool(_enabledKey, false);
      if (_ready) await _plugin.cancelAll();
      return false;
    }
    if (!_ready) return false;
    final android = _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    final ios = _plugin.resolvePlatformSpecificImplementation<IOSFlutterLocalNotificationsPlugin>();
    final granted = await android?.requestNotificationsPermission() ?? await ios?.requestPermissions(alert: true, sound: true) ?? false;
    await prefs.setBool(_enabledKey, granted);
    return granted;
  }

  static int _id(String kind, String id) => '$kind:$id'.hashCode & 0x7fffffff;

  /// "15:00" or "3:00 PM" → (hour, minute).
  static (int, int)? _parseTime(String? raw) {
    if (raw == null || raw.trim().isEmpty) return null;
    final match = RegExp(r'^(\d{1,2}):(\d{2})\s*([ap]m)?', caseSensitive: false).firstMatch(raw.trim());
    if (match == null) return null;
    var hour = int.parse(match[1]!);
    final minute = int.parse(match[2]!);
    final meridiem = match[3]?.toLowerCase();
    if (meridiem == 'pm' && hour < 12) hour += 12;
    if (meridiem == 'am' && hour == 12) hour = 0;
    return hour < 24 && minute < 60 ? (hour, minute) : null;
  }

  /// Plans which reminders to show; pure so it can be unit-tested.
  @visibleForTesting
  static List<({int id, String title, String body, DateTime at})> plan(List<TodoTask> tasks, List<CalendarEvent> events, DateTime now) {
    final out = <({int id, String title, String body, DateTime at})>[];
    final until = now.add(_horizon);

    for (final task in tasks) {
      if (task.completed || task.dueDate == null) continue;
      final day = DateTime.tryParse(task.dueDate!);
      if (day == null) continue;
      final time = _parseTime(task.dueTime);
      final at = time != null ? DateTime(day.year, day.month, day.day, time.$1, time.$2) : DateTime(day.year, day.month, day.day, 9);
      if (at.isAfter(now) && at.isBefore(until)) {
        out.add((id: _id('task', task.id), title: task.title, body: time != null ? 'Task due now' : 'Task due today', at: at));
      }
    }

    for (final event in events) {
      final start = event.startTime.toLocal();
      final at = event.allDay ? DateTime(start.year, start.month, start.day, 8) : start.subtract(const Duration(minutes: 10));
      if (at.isAfter(now) && at.isBefore(until)) {
        final where = event.location.isNotEmpty ? ' · ${event.location}' : '';
        out.add((id: _id('event', event.id), title: event.title, body: event.allDay ? 'Today$where' : 'Starts in 10 minutes$where', at: at));
      }
    }

    out.sort((a, b) => a.at.compareTo(b.at));
    return out.take(_maxScheduled).toList();
  }

  static Future<void> sync(List<TodoTask> tasks, List<CalendarEvent> events) async {
    if (!_ready || !await isEnabled()) return;
    try {
      await _plugin.cancelAll();
      for (final reminder in plan(tasks, events, DateTime.now())) {
        await _plugin.zonedSchedule(
          id: reminder.id,
          title: reminder.title,
          body: reminder.body,
          scheduledDate: tz.TZDateTime.from(reminder.at, tz.local),
          notificationDetails: _details,
          // Inexact keeps us clear of the exact-alarm permission; a few minutes
          // of drift is fine for reminders.
          androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
        );
      }
    } catch (e) {
      debugPrint('[Reminders] could not schedule: $e');
    }
  }
}
