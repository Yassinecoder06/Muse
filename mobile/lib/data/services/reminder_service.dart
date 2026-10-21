import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart' show Color;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;
import '../models/event.dart';
import '../models/task.dart';
import 'app_events.dart';
import 'device_timezone.dart';

/// Phone notifications for tasks and events.
///
/// * Reminders the user sets on a task are real alarms: exact time, alarm
///   sound that repeats until handled, shown over the lock screen, a live
///   countdown to the due time, and Done / Snooze buttons. Bip delivers them.
/// * With "Reminders" on in Settings, other timed tasks and events also get a
///   gentle notification.
///
/// Everything is rebuilt from the latest lists whenever the Tasks tab loads.
class ReminderService {
  ReminderService._();

  static final _plugin = FlutterLocalNotificationsPlugin();
  static const _enabledKey = 'muse_reminders_enabled';
  static const _horizon = Duration(days: 14);
  static const _alarmHorizon = Duration(days: 60);
  static const _maxScheduled = 60;
  static const _insistentFlag = 4; // Notification.FLAG_INSISTENT: loop the sound until handled
  static bool _ready = false;
  static const testTaskId = 'test-alarm';

  /// Alarms scheduled by the last sync. The main screen watches this to open
  /// the Bip alarm itself when one is due while Muse is open (no reliance on
  /// the system delivering the notification).
  static final ValueNotifier<List<({String taskId, String title, DateTime at, DateTime? due})>> planned = ValueNotifier(const []);

  static const _softDetails = NotificationDetails(
    android: AndroidNotificationDetails(
      'muse_reminders',
      'Reminders',
      channelDescription: 'Upcoming tasks and calendar events from Muse',
      importance: Importance.high,
      priority: Priority.high,
    ),
    iOS: DarwinNotificationDetails(),
  );

  static const bipLines = [
    'Beep boop! Time to get this done ✨',
    'Bzzt! Your reminder is here 🤖',
    'Ding ding! Bip is on duty ⏰',
    "Psst… don't forget this one! 💜",
  ];

  static NotificationDetails _alarmDetails(DateTime? due) => NotificationDetails(
        android: AndroidNotificationDetails(
          'muse_alarms',
          'Bip alarms',
          channelDescription: 'Task reminders you set: ring like an alarm until handled',
          importance: Importance.max,
          priority: Priority.max,
          category: AndroidNotificationCategory.alarm,
          audioAttributesUsage: AudioAttributesUsage.alarm,
          sound: const UriAndroidNotificationSound('content://settings/system/alarm_alert'),
          additionalFlags: Int32List.fromList([_insistentFlag]),
          fullScreenIntent: true,
          visibility: NotificationVisibility.public,
          color: const Color(0xFF7C3AED),
          // Live countdown to the due time right in the notification.
          when: due?.millisecondsSinceEpoch,
          showWhen: due != null,
          usesChronometer: due != null,
          chronometerCountDown: due != null,
          actions: const [
            AndroidNotificationAction('done', 'Done ✓', showsUserInterface: true),
            AndroidNotificationAction('snooze', 'Snooze 5 min', showsUserInterface: true),
          ],
        ),
        iOS: const DarwinNotificationDetails(interruptionLevel: InterruptionLevel.timeSensitive),
      );

  static Future<void> init() async {
    try {
      tzdata.initializeTimeZones();
      try {
        tz.setLocalLocation(tz.getLocation(DeviceTimezone.id ?? 'UTC'));
      } catch (_) {
        tz.setLocalLocation(tz.UTC);
      }
      await _plugin.initialize(
        settings: const InitializationSettings(
          android: AndroidInitializationSettings('@mipmap/ic_launcher'),
          iOS: DarwinInitializationSettings(requestAlertPermission: false, requestBadgePermission: false, requestSoundPermission: false),
        ),
        onDidReceiveNotificationResponse: _onResponse,
      );
      _ready = true;

      // Opened by tapping an alarm while the app was closed.
      final launch = await _plugin.getNotificationAppLaunchDetails();
      final response = launch?.notificationResponse;
      if (launch?.didNotificationLaunchApp == true && response != null) _onResponse(response);
    } catch (e) {
      debugPrint('[Reminders] unavailable: $e');
    }
  }

  static void _onResponse(NotificationResponse response) {
    final payload = response.payload;
    if (payload != null && payload.contains('"taskId"')) {
      AppEvents.alarmTapped.value = (payload: payload, action: response.actionId);
      return;
    }
    if (response.actionId != null && response.actionId!.startsWith('music_')) {
      AppEvents.musicAction.value = response.actionId;
      return;
    }
    if (payload == 'muse_music') {
      AppEvents.musicAction.value = response.actionId ?? 'music_open';
      return;
    }
  }

  static Future<bool> isEnabled() async => (await SharedPreferences.getInstance()).getBool(_enabledKey) ?? false;

  static Future<bool> _requestNotificationPermission() async {
    final android = _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    final ios = _plugin.resolvePlatformSpecificImplementation<IOSFlutterLocalNotificationsPlugin>();
    return await android?.requestNotificationsPermission() ?? await ios?.requestPermissions(alert: true, sound: true) ?? false;
  }

  /// Turning automatic reminders on asks for notification permission; returns
  /// whether they ended up enabled.
  static Future<bool> setEnabled(bool enabled) async {
    final prefs = await SharedPreferences.getInstance();
    if (!enabled) {
      await prefs.setBool(_enabledKey, false);
      AppEvents.notifyDataChanged(); // Tasks tab reloads and reschedules without them
      return false;
    }
    if (!_ready) return false;
    final granted = await _requestNotificationPermission();
    await prefs.setBool(_enabledKey, granted);
    AppEvents.notifyDataChanged();
    return granted;
  }

  /// Called when the user sets a reminder: notifications plus exact alarms
  /// (Android 12+ asks for that in system settings). Returns false if
  /// notifications are blocked.
  static Future<bool> ensureAlarmPermissions() async {
    if (!_ready) return false;
    final granted = await _requestNotificationPermission();
    final android = _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    if (android != null && await android.canScheduleExactNotifications() == false) {
      await android.requestExactAlarmsPermission();
    }
    return granted;
  }

  static int _id(String kind, String id) => '$kind:$id'.hashCode & 0x7fffffff;
  static int alarmId(String taskId) => _id('alarm', taskId);

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

  static String bipLine(String seed) => bipLines[seed.length % bipLines.length];

  /// Alarms for reminders the user set on tasks; pure for tests.
  @visibleForTesting
  static List<({int id, String taskId, String title, DateTime at, DateTime? due})> planAlarms(List<TodoTask> tasks, DateTime now) {
    final until = now.add(_alarmHorizon);
    final out = [
      for (final task in tasks)
        if (!task.completed && task.reminderAt != null && task.reminderAt!.isAfter(now) && task.reminderAt!.isBefore(until))
          (id: alarmId(task.id), taskId: task.id, title: task.title, at: task.reminderAt!, due: task.dueAt),
    ]..sort((a, b) => a.at.compareTo(b.at));
    return out.take(_maxScheduled).toList();
  }

  /// Gentle notifications when automatic reminders are on; pure for tests.
  /// Tasks with their own reminder are left to [planAlarms].
  @visibleForTesting
  static List<({int id, String title, String body, DateTime at})> plan(List<TodoTask> tasks, List<CalendarEvent> events, DateTime now) {
    final out = <({int id, String title, String body, DateTime at})>[];
    final until = now.add(_horizon);

    for (final task in tasks) {
      if (task.completed || task.dueDate == null || task.reminderAt != null) continue;
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

  static Future<AndroidScheduleMode> _alarmMode() async {
    final android = _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    if (android == null) return AndroidScheduleMode.alarmClock;
    // Exact "alarm clock" timing when allowed; otherwise as close as Android permits.
    return await android.canScheduleExactNotifications() == true ? AndroidScheduleMode.alarmClock : AndroidScheduleMode.inexactAllowWhileIdle;
  }

  static Future<void> _scheduleAlarm({required int id, required String taskId, required String title, required DateTime at, DateTime? due, AndroidScheduleMode? mode}) {
    return _plugin.zonedSchedule(
      id: id,
      title: '🤖 Bip: $title',
      body: bipLine(title),
      scheduledDate: tz.TZDateTime.from(at, tz.local),
      notificationDetails: _alarmDetails(due),
      androidScheduleMode: mode ?? AndroidScheduleMode.alarmClock,
      payload: jsonEncode({'taskId': taskId, 'title': title, 'due': due?.millisecondsSinceEpoch}),
    );
  }

  // Snoozes are kept on the phone (they must work offline and survive list
  // refreshes until the server knows about them): {taskId: {at, title, due}}.
  static const _snoozeKey = 'muse_alarm_snoozes';

  static Future<Map<String, dynamic>> _readSnoozes() async {
    try {
      final raw = (await SharedPreferences.getInstance()).getString(_snoozeKey);
      return raw == null ? {} : (jsonDecode(raw) as Map).cast<String, dynamic>();
    } catch (_) {
      return {};
    }
  }

  static Future<void> _writeSnoozes(Map<String, dynamic> snoozes) async =>
      (await SharedPreferences.getInstance()).setString(_snoozeKey, jsonEncode(snoozes));

  static Future<void> sync(List<TodoTask> tasks, List<CalendarEvent> events) async {
    if (!_ready) return;
    try {
      final now = DateTime.now();
      final mode = await _alarmMode();

      // Snoozes still ahead, for tasks that are still open, override the
      // server's reminder time (which is usually in the past by then).
      final open = {for (final t in tasks) if (!t.completed) t.id: t};
      final snoozes = await _readSnoozes();
      snoozes.removeWhere((taskId, value) => !open.containsKey(taskId) || DateTime.tryParse((value as Map)['at'] as String? ?? '')?.isAfter(now) != true);
      await _writeSnoozes(snoozes);

      final alarms = [
        ...planAlarms(tasks.where((t) => !snoozes.containsKey(t.id)).toList(), now),
        for (final MapEntry(key: taskId, value: snooze) in snoozes.entries)
          (
            id: alarmId(taskId),
            taskId: taskId,
            title: open[taskId]!.title,
            at: DateTime.parse((snooze as Map)['at'] as String),
            due: open[taskId]!.dueAt,
          ),
      ]..sort((x, y) => x.at.compareTo(y.at));
      final soft = await isEnabled() ? plan(tasks, events, now) : const <({int id, String title, String body, DateTime at})>[];

      // Cancel only pending alarms that are no longer wanted. A ringing alarm
      // is not "pending", so refreshing never silences it; the test alarm is
      // left alone too.
      final wanted = {...alarms.map((a) => a.id), ...soft.map((r) => r.id), alarmId(testTaskId)};
      for (final pending in await _plugin.pendingNotificationRequests()) {
        if (!wanted.contains(pending.id)) await _plugin.cancel(id: pending.id);
      }

      for (final alarm in alarms) {
        await _scheduleAlarm(id: alarm.id, taskId: alarm.taskId, title: alarm.title, at: alarm.at, due: alarm.due, mode: mode);
      }
      planned.value = [for (final a in alarms) (taskId: a.taskId, title: a.title, at: a.at, due: a.due)];
      for (final reminder in soft) {
        await _plugin.zonedSchedule(
          id: reminder.id,
          title: reminder.title,
          body: reminder.body,
          scheduledDate: tz.TZDateTime.from(reminder.at, tz.local),
          notificationDetails: _softDetails,
          // A few minutes of drift is fine for automatic reminders.
          androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
        );
      }
    } catch (e) {
      debugPrint('[Reminders] could not schedule: $e');
    }
  }

  /// Ring again in [minutes], right away on the phone (works offline).
  static Future<void> snooze({required String taskId, required String title, DateTime? due, int minutes = 5}) async {
    if (!_ready) return;
    final at = DateTime.now().add(Duration(minutes: minutes));
    if (taskId != testTaskId) {
      final snoozes = await _readSnoozes();
      snoozes[taskId] = {'at': at.toIso8601String()};
      await _writeSnoozes(snoozes);
    }
    await _plugin.cancel(id: alarmId(taskId));
    await _scheduleAlarm(id: alarmId(taskId), taskId: taskId, title: title, at: at, due: due, mode: await _alarmMode());
  }

  /// Rings a sample Bip alarm in [seconds] so the user can check sound,
  /// pop-up, and lock-screen display on their phone.
  static Future<void> testAlarm({int seconds = 10}) async {
    if (!_ready) return;
    await _scheduleAlarm(
      id: alarmId(testTaskId),
      taskId: testTaskId,
      title: 'Test alarm',
      at: DateTime.now().add(Duration(seconds: seconds)),
      due: DateTime.now().add(Duration(seconds: seconds + 120)),
      mode: await _alarmMode(),
    );
  }

  /// Stops a ringing alarm (the looping sound ends with the notification)
  /// and forgets any snooze for it (handled or dismissed).
  static Future<void> stopAlarm(String taskId) async {
    final snoozes = await _readSnoozes();
    if (snoozes.remove(taskId) != null) await _writeSnoozes(snoozes);
    if (_ready) await _plugin.cancel(id: alarmId(taskId));
  }
}
