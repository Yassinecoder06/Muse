import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Clean regex patterns matching emojis, pictographs, flags, variation selectors,
/// skin tone modifiers, and keycaps for natural read-aloud without description noise.
final _emojiRegex = RegExp(
  r'[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{200D}\u{FE0E}\u{FE0F}]',
  unicode: true,
);

/// Strips Markdown syntax, HTML tags, links, emojis, and code blocks
/// so the synthetic voice reads natural, conversational prose.
String cleanTextForSpeech(String text) {
  if (text.isEmpty) return '';

  return text
      // Remove fenced code blocks completely
      .replaceAll(RegExp(r'```[\s\S]*?```'), ' ')
      // Remove inline code
      .replaceAllMapped(RegExp(r'`([^`]+)`'), (m) => m[1] ?? '')
      // Remove markdown image syntax ![alt](url)
      .replaceAll(RegExp(r'!\[([^\]]*)\]\([^)]+\)'), '')
      // Replace markdown links [text](url) with just text
      .replaceAllMapped(RegExp(r'\[([^\]]+)\]\([^)]+\)'), (m) => m[1] ?? '')
      // Remove URLs
      .replaceAll(RegExp(r'https?:\/\/[^\s)]+'), '')
      // Remove headers (#, ##, ###)
      .replaceAll(RegExp(r'^#{1,6}\s+', multiLine: true), '')
      // Remove blockquotes (> )
      .replaceAll(RegExp(r'^>\s+', multiLine: true), '')
      // Remove bullet points and numbered list markers
      .replaceAll(RegExp(r'^[\s]*[-*+]\s+', multiLine: true), '')
      .replaceAll(RegExp(r'^[\s]*\d+\.\s+', multiLine: true), '')
      // Remove bold and italic markers
      .replaceAllMapped(RegExp(r'(\*\*|__)(.*?)\1'), (m) => m[2] ?? '')
      .replaceAllMapped(RegExp(r'(\*|_)(.*?)\1'), (m) => m[2] ?? '')
      .replaceAllMapped(RegExp(r'~~(.*?)~~'), (m) => m[1] ?? '')
      // Remove horizontal rules
      .replaceAll(RegExp(r'^-{3,}$', multiLine: true), '')
      // Remove HTML tags
      .replaceAll(RegExp(r'<[^>]*>'), ' ')
      // Remove action card markers or tool call artifacts
      .replaceAll(RegExp(r'\[IMAGE \d+\]', caseSensitive: false), '')
      // Remove emojis & pictographs so TTS doesn't read them
      .replaceAll(_emojiRegex, '')
      // Remove empty brackets or parentheses left behind
      .replaceAll(RegExp(r'\(\s*\)'), '')
      .replaceAll(RegExp(r'\[\s*\]'), '')
      // Clean up spaces before punctuation marks created by emoji or markdown removal
      .replaceAll(RegExp(r'\s+([.,!?;:])'), r'$1')
      // Insert natural sentence pause on line breaks without terminal punctuation
      .replaceAllMapped(RegExp(r'([^.,!?;:])\s*\n+'), (m) => '${m[1]}. ')
      // Collapse multiple whitespace
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
}

/// On-device Text-to-Speech (TTS) service using the platform's speech synthesizer.
class TtsService {
  static final TtsService _instance = TtsService._internal();
  factory TtsService() => _instance;
  TtsService._internal();

  static const _keyAutoReadAloud = 'muse_tts_auto_read_aloud';
  static const _keySpeechRate = 'muse_tts_speech_rate';

  final FlutterTts _tts = FlutterTts();
  bool _initialized = false;

  final ValueNotifier<bool> isSpeaking = ValueNotifier<bool>(false);
  final ValueNotifier<String?> currentUtteranceId = ValueNotifier<String?>(null);

  VoidCallback? _onStartCallback;
  VoidCallback? _onDoneCallback;
  VoidCallback? _onErrorCallback;

  Future<void> _ensureInit() async {
    if (_initialized) return;

    try {
      await _tts.setLanguage('en-US');
      // On Android flutter_tts, 0.5 is 1.0x normal speed.
      final rate = await getSpeechRate();
      await _tts.setSpeechRate(rate);
      await _tts.setPitch(1.0);
      await _tts.setVolume(1.0);

      _tts.setStartHandler(() {
        isSpeaking.value = true;
        _onStartCallback?.call();
      });

      _tts.setCompletionHandler(() {
        isSpeaking.value = false;
        currentUtteranceId.value = null;
        _onDoneCallback?.call();
        _clearCallbacks();
      });

      _tts.setCancelHandler(() {
        isSpeaking.value = false;
        currentUtteranceId.value = null;
        _onDoneCallback?.call();
        _clearCallbacks();
      });

      _tts.setErrorHandler((dynamic msg) {
        debugPrint('[TtsService] error: $msg');
        isSpeaking.value = false;
        currentUtteranceId.value = null;
        _onErrorCallback?.call();
        _clearCallbacks();
      });

      _initialized = true;
    } catch (e) {
      debugPrint('[TtsService] init failed: $e');
    }
  }

  void _clearCallbacks() {
    _onStartCallback = null;
    _onDoneCallback = null;
    _onErrorCallback = null;
  }

  /// Speaks the given text aloud. Cleans markdown and emojis first.
  /// If [utteranceId] is provided, it tracks which message/item is currently playing.
  Future<bool> speak(
    String rawText, {
    String? utteranceId,
    VoidCallback? onStart,
    VoidCallback? onDone,
    VoidCallback? onError,
  }) async {
    await _ensureInit();
    await stop();

    final cleaned = cleanTextForSpeech(rawText);
    if (cleaned.isEmpty) {
      onDone?.call();
      return false;
    }

    currentUtteranceId.value = utteranceId;
    _onStartCallback = onStart;
    _onDoneCallback = onDone;
    _onErrorCallback = onError;

    try {
      final res = await _tts.speak(cleaned);
      return res == 1;
    } catch (e) {
      debugPrint('[TtsService] speak failed: $e');
      isSpeaking.value = false;
      currentUtteranceId.value = null;
      onError?.call();
      return false;
    }
  }

  /// Stops any currently playing speech.
  Future<void> stop() async {
    try {
      await _tts.stop();
    } catch (_) {}
    isSpeaking.value = false;
    currentUtteranceId.value = null;
    _clearCallbacks();
  }

  /// Pauses playback if supported.
  Future<void> pause() async {
    try {
      await _tts.pause();
    } catch (_) {}
    isSpeaking.value = false;
  }

  /// Whether auto-read aloud is enabled for assistant responses. Default is true.
  Future<bool> getAutoReadAloud() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_keyAutoReadAloud) ?? true;
  }

  Future<void> setAutoReadAloud(bool enabled) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_keyAutoReadAloud, enabled);
  }

  /// Speech rate (0.3 to 0.7; 0.5 is normal speed on Android).
  Future<double> getSpeechRate() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getDouble(_keySpeechRate) ?? 0.5;
  }

  Future<void> setSpeechRate(double rate) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setDouble(_keySpeechRate, rate);
    if (_initialized) {
      await _tts.setSpeechRate(rate);
    }
  }
}
