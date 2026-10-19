import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:speech_to_text/speech_recognition_error.dart';
import 'package:speech_to_text/speech_recognition_result.dart';
import 'package:speech_to_text/speech_to_text.dart' as stt;

/// Continuous dictation on top of the platform recognizer.
///
/// Android ends a recognition session by itself after a short pause (often 2–5
/// seconds, regardless of what the app asks for). This service keeps the text
/// recognized so far and quietly starts a new session until the user presses
/// stop, so dictation feels like one long recording.
class VoiceService {
  static final VoiceService _instance = VoiceService._internal();
  factory VoiceService() => _instance;
  VoiceService._internal();

  final stt.SpeechToText _speech = stt.SpeechToText();
  bool _initialized = false;

  // Current dictation session (only one screen dictates at a time).
  bool _active = false;
  String _committed = '';
  String _partial = '';
  int _restartFailures = 0;
  DateTime _sessionStartedAt = DateTime.now();
  Timer? _restartTimer;
  void Function(String text)? _onText;
  void Function(String error)? _onError;
  void Function()? _onStopped;

  bool get isDictating => _active;

  Future<bool> _ensureInitialized() async {
    if (_initialized && _speech.isAvailable) return true;
    try {
      // Handlers are registered once and route to whichever screen is
      // dictating now (they used to stay bound to the first screen).
      _initialized = await _speech.initialize(onError: _handleError, onStatus: _handleStatus);
      return _initialized;
    } catch (e) {
      debugPrint('[VoiceService] initialize failed: $e');
      return false;
    }
  }

  String get _fullText => [_committed, _partial].where((part) => part.trim().isNotEmpty).join(' ').trim();

  /// Starts dictation. [onText] receives everything said so far (all
  /// segments joined). Returns false if the microphone is unavailable.
  Future<bool> startDictation({
    required void Function(String text) onText,
    void Function(String error)? onError,
    void Function()? onStopped,
  }) async {
    if (!await _ensureInitialized()) return false;
    if (_active) await stop(); // another screen was dictating
    _onText = onText;
    _onError = onError;
    _onStopped = onStopped;
    _committed = '';
    _partial = '';
    _restartFailures = 0;
    _active = true;
    await _listen();
    return true;
  }

  Future<void> _listen() async {
    if (!_active) return;
    _sessionStartedAt = DateTime.now();
    try {
      await _speech.listen(
        onResult: _handleResult,
        // Ask for long sessions; Android may still end them early, which
        // _handleStatus covers by restarting.
        listenOptions: stt.SpeechListenOptions(
          listenFor: const Duration(minutes: 10),
          pauseFor: const Duration(seconds: 30),
          listenMode: stt.ListenMode.dictation,
          partialResults: true,
          cancelOnError: false,
        ),
      );
    } catch (e) {
      debugPrint('[VoiceService] listen failed: $e');
      _scheduleRestart();
    }
  }

  void _handleResult(SpeechRecognitionResult result) {
    if (!_active) return;
    if (result.finalResult) {
      _committed = [_committed, result.recognizedWords].where((part) => part.trim().isNotEmpty).join(' ');
      _partial = '';
    } else {
      _partial = result.recognizedWords;
    }
    _restartFailures = 0;
    _onText?.call(_fullText);
  }

  void _handleStatus(String status) {
    debugPrint('[VoiceService] status: $status');
    if (!_active) return;
    if (status == 'done' || status == 'notListening') {
      // The platform ended the session; start a new one shortly. The final
      // result for this session may still be on its way.
      _scheduleRestart();
    }
  }

  void _handleError(SpeechRecognitionError error) {
    debugPrint('[VoiceService] error: ${error.errorMsg} (permanent: ${error.permanent})');
    if (!_active) return;
    // Silence ("no match" / "speech timeout") is normal mid-dictation.
    const benign = {'error_no_match', 'error_speech_timeout', 'error_busy', 'error_client'};
    if (benign.contains(error.errorMsg)) {
      _scheduleRestart();
      return;
    }
    _onError?.call(error.errorMsg);
    unawaited(stop());
  }

  void _scheduleRestart() {
    if (!_active || _restartTimer?.isActive == true) return;
    // Only sessions that die almost immediately count as failures; a normal
    // session that ended after a pause (even a silent one) does not.
    if (DateTime.now().difference(_sessionStartedAt) > const Duration(seconds: 2)) _restartFailures = 0;
    _restartFailures++;
    if (_restartFailures > 8) {
      // The recognizer keeps failing (no network for online recognition,
      // mic taken by another app): stop instead of looping forever.
      _onError?.call('Speech recognition keeps stopping. Check your connection and microphone.');
      unawaited(stop());
      return;
    }
    _restartTimer = Timer(Duration(milliseconds: 500 + 150 * _restartFailures), () {
      if (!_active || _speech.isListening) return;
      // No final result came for the last words: keep them as said.
      if (_partial.trim().isNotEmpty) {
        _committed = _fullText;
        _partial = '';
      }
      _listen();
    });
  }

  /// User pressed stop: keeps what was said and ends dictation.
  Future<void> stop() async {
    if (!_active) return;
    _active = false;
    _restartTimer?.cancel();
    if (_speech.isListening) await _speech.stop();
    final stopped = _onStopped;
    _onText = null;
    _onError = null;
    _onStopped = null;
    stopped?.call();
  }

  /// Screen closed: end dictation without callbacks.
  Future<void> cancel() async {
    _active = false;
    _restartTimer?.cancel();
    _onText = null;
    _onError = null;
    _onStopped = null;
    if (_speech.isListening) await _speech.cancel();
  }
}
