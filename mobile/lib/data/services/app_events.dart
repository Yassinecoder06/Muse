import 'package:flutter/foundation.dart';

/// App-wide signals shared by tabs that are otherwise independent.
class AppEvents {
  AppEvents._();

  /// Bumped when Bip (or a confirmation) changes notes, tasks, or events, so
  /// the Notes and Tasks tabs reload instead of showing stale lists.
  static final ValueNotifier<int> dataChanged = ValueNotifier<int>(0);

  /// Set when the server rejects this phone's device token (it was revoked on
  /// the desktop). The app root listens and returns to the pairing screen.
  static final ValueNotifier<bool> deviceUnpaired = ValueNotifier<bool>(false);

  /// Home-screen shortcut the app was opened with: 'voice_note', 'new_note',
  /// or 'ask_bip'. Consumers reset it to null once handled.
  static final ValueNotifier<String?> launchAction = ValueNotifier<String?>(null);

  /// One-off message from background sync (e.g. an edit conflict), shown as
  /// a snackbar by the main scaffold, which then clears it.
  static final ValueNotifier<String?> syncMessage = ValueNotifier<String?>(null);

  /// A Bip alarm notification was tapped (or one of its buttons): payload
  /// JSON plus the action id ('done', 'snooze', or null for a plain tap).
  static final ValueNotifier<({String payload, String? action})?> alarmTapped = ValueNotifier(null);

  /// Media playback action tapped from the phone's notification ('music_play',
  /// 'music_pause', 'music_next', 'music_prev', etc.).
  static final ValueNotifier<String?> musicAction = ValueNotifier<String?>(null);

  /// Active notes filter scope ('all', 'favorites', 'archive', 'trash').
  static final ValueNotifier<String> notesScope = ValueNotifier<String>('all');

  static void notifyDataChanged() => dataChanged.value++;
}
