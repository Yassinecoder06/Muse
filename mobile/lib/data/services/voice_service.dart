import 'package:flutter/foundation.dart';
import 'package:speech_to_text/speech_recognition_error.dart';
import 'package:speech_to_text/speech_recognition_result.dart';
import 'package:speech_to_text/speech_to_text.dart' as stt;

class VoiceService {
  static final VoiceService _instance = VoiceService._internal();
  factory VoiceService() => _instance;
  VoiceService._internal();

  final stt.SpeechToText _speech = stt.SpeechToText();
  bool _isInitialized = false;

  bool get isListening => _speech.isListening;
  bool get isAvailable => _speech.isAvailable;

  Future<bool> initialize({
    Function(String error)? onError,
    Function(String status)? onStatus,
  }) async {
    if (_isInitialized) return _speech.isAvailable;

    try {
      _isInitialized = await _speech.initialize(
        onError: (SpeechRecognitionError error) {
          debugPrint('[VoiceService] error: ${error.errorMsg} (permanent: ${error.permanent})');
          onError?.call(error.errorMsg);
        },
        onStatus: (String status) {
          debugPrint('[VoiceService] status: $status');
          onStatus?.call(status);
        },
      );
      return _isInitialized;
    } catch (e) {
      debugPrint('[VoiceService] Exception initializing speech: $e');
      onError?.call(e.toString());
      return false;
    }
  }

  Future<void> startListening({
    required Function(String words, bool isFinal) onResult,
    String? localeId,
  }) async {
    if (!_isInitialized) {
      final ok = await initialize();
      if (!ok) {
        throw Exception('Microphone permission not granted or speech recognition unavailable on this device.');
      }
    }

    if (_speech.isListening) {
      await stopListening();
      return;
    }

    final options = stt.SpeechListenOptions(
      listenMode: stt.ListenMode.dictation,
      cancelOnError: false,
      partialResults: true,
    );

    await _speech.listen(
      onResult: (SpeechRecognitionResult result) {
        onResult(result.recognizedWords, result.finalResult);
      },
      listenOptions: options,
    );
  }

  Future<void> stopListening() async {
    if (_speech.isListening) {
      await _speech.stop();
    }
  }

  Future<void> cancelListening() async {
    if (_speech.isListening) {
      await _speech.cancel();
    }
  }
}
