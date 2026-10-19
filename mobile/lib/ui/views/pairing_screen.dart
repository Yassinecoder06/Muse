import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../../data/services/api_service.dart';
import '../theme/app_theme.dart';
import 'main_scaffold.dart';

class PairingScreen extends StatefulWidget {
  const PairingScreen({super.key});

  @override
  State<PairingScreen> createState() => _PairingScreenState();
}

class _PairingScreenState extends State<PairingScreen> {
  final ApiService _api = ApiService();
  bool _isManual = false;
  bool _loading = false;
  String? _errorMessage;

  // Manual inputs
  final TextEditingController _urlController = TextEditingController(text: 'http://192.168.100.136:8080');
  final TextEditingController _pinController = TextEditingController();

  MobileScannerController? _cameraController;
  bool _hasScanned = false;

  @override
  void initState() {
    super.initState();
    _cameraController = MobileScannerController(
      detectionSpeed: DetectionSpeed.noDuplicates,
      facing: CameraFacing.back,
    );
  }

  @override
  void dispose() {
    _cameraController?.dispose();
    _urlController.dispose();
    _pinController.dispose();
    super.dispose();
  }

  Future<void> _handleBarcode(BarcodeCapture capture) async {
    if (_hasScanned || _loading) return;
    final List<Barcode> barcodes = capture.barcodes;
    if (barcodes.isEmpty) return;

    final rawValue = barcodes.first.rawValue;
    if (rawValue == null || rawValue.isEmpty) return;

    setState(() {
      _hasScanned = true;
      _loading = true;
      _errorMessage = null;
    });

    try {
      String? serverUrl;
      String? token;
      String? pin;

      if (rawValue.startsWith('muse://pair?data=')) {
        final encoded = rawValue.replaceFirst('muse://pair?data=', '');
        final jsonStr = utf8.decode(base64Url.decode(base64Url.normalize(encoded)));
        final data = jsonDecode(jsonStr);
        serverUrl = (data['serverUrl'] ?? data['u'])?.toString();
        token = (data['token'] ?? data['t'])?.toString();
        pin = (data['pin'] ?? data['pinCode'] ?? data['p'])?.toString();
      } else {
        // Try direct JSON
        try {
          final data = jsonDecode(rawValue);
          serverUrl = (data['serverUrl'] ?? data['u'])?.toString();
          token = (data['token'] ?? data['t'])?.toString();
          pin = (data['pin'] ?? data['pinCode'] ?? data['p'])?.toString();
        } catch (_) {
          // If plain text token or url
          serverUrl = _urlController.text.trim();
          token = rawValue.trim();
        }
      }

      if (serverUrl == null || serverUrl.isEmpty) {
        throw Exception('Invalid QR code format. Missing server address.');
      }

      await _claim(serverUrl: serverUrl, token: token, pin: pin);
    } catch (e) {
      setState(() {
        _loading = false;
        _hasScanned = false;
        _errorMessage = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _handleManualConnect() async {
    final url = _urlController.text.trim();
    final pin = _pinController.text.trim();

    if (url.isEmpty) {
      setState(() => _errorMessage = 'Please enter your Muse server address.');
      return;
    }
    if (pin.isEmpty) {
      setState(() => _errorMessage = 'Please enter the 6-digit PIN from desktop.');
      return;
    }

    setState(() {
      _loading = true;
      _errorMessage = null;
    });

    try {
      await _claim(serverUrl: url, token: null, pin: pin);
    } catch (e) {
      setState(() {
        _loading = false;
        _errorMessage = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _claim({required String serverUrl, String? token, String? pin}) async {
    await _api.claimPairing(
      serverUrl: serverUrl,
      token: token,
      pin: pin,
      deviceName: 'Xiaomi Redmi Note 13',
      deviceModel: 'Android 15',
    );

    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const MainScaffold()),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        title: const Text('Pair with Muse Desktop'),
        actions: [
          IconButton(
            icon: Icon(_isManual ? Icons.qr_code_scanner : Icons.edit_note),
            tooltip: _isManual ? 'Use QR Scanner' : 'Enter Manually',
            onPressed: () {
              setState(() {
                _isManual = !_isManual;
                _errorMessage = null;
              });
            },
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            if (_errorMessage != null)
              Container(
                margin: const EdgeInsets.all(16),
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                decoration: BoxDecoration(
                  color: Colors.red.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.red.withValues(alpha: 0.3)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.error_outline, color: Colors.redAccent, size: 20),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        _errorMessage!,
                        style: const TextStyle(color: Colors.redAccent, fontSize: 13),
                      ),
                    ),
                  ],
                ),
              ),

            Expanded(
              child: _isManual ? _buildManualForm() : _buildScannerView(),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildScannerView() {
    return Column(
      children: [
        const SizedBox(height: 16),
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 24),
          child: Text(
            'Point camera at the QR code displayed on your Muse desktop screen (Link Phone modal).',
            textAlign: TextAlign.center,
            style: TextStyle(color: AppTheme.textSecondary, fontSize: 14, height: 1.4),
          ),
        ),
        const SizedBox(height: 24),
        Expanded(
          child: Center(
            child: Container(
              width: 280,
              height: 280,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(24),
                border: Border.all(color: AppTheme.primary, width: 2),
              ),
              clipBehavior: Clip.antiAlias,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  MobileScanner(
                    controller: _cameraController,
                    onDetect: _handleBarcode,
                  ),
                  if (_loading)
                    Container(
                      color: Colors.black54,
                      child: const Center(
                        child: CircularProgressIndicator(color: AppTheme.primaryLight),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(24.0),
          child: TextButton.icon(
            icon: const Icon(Icons.keyboard_outlined, size: 18),
            label: const Text('Cannot scan? Enter 6-digit PIN manually'),
            style: TextButton.styleFrom(foregroundColor: AppTheme.primaryLight),
            onPressed: () => setState(() => _isManual = true),
          ),
        ),
      ],
    );
  }

  Widget _buildManualForm() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(
            child: Container(
              width: 72,
              height: 72,
              margin: const EdgeInsets.only(bottom: 20, top: 4),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(18),
                boxShadow: [
                  BoxShadow(
                    color: AppTheme.primaryLight.withValues(alpha: 0.35),
                    blurRadius: 16,
                    offset: const Offset(0, 5),
                  ),
                ],
              ),
              clipBehavior: Clip.antiAlias,
              child: Image.asset('assets/images/muse_logo.png', fit: BoxFit.cover),
            ),
          ),
          const Text(
            'Manual Pairing',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
          ),
          const SizedBox(height: 8),
          const Text(
            'Enter your computer local IP and the 6-digit PIN shown in the desktop Link Phone modal.',
            style: TextStyle(color: AppTheme.textSecondary, fontSize: 13, height: 1.4),
          ),
          const SizedBox(height: 24),
          const Text('Muse Server Address', style: TextStyle(color: AppTheme.textPrimary, fontSize: 13, fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          TextField(
            controller: _urlController,
            style: const TextStyle(color: AppTheme.textPrimary, fontSize: 15),
            decoration: InputDecoration(
              hintText: 'http://192.168.100.136:8080',
              filled: true,
              fillColor: AppTheme.surface,
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppTheme.surfaceBorder)),
              enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppTheme.surfaceBorder)),
              focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppTheme.primaryLight)),
              prefixIcon: const Icon(Icons.wifi, color: AppTheme.textSecondary, size: 20),
            ),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            children: [
              ActionChip(
                label: const Text('LAN (192.168.100.136:8080)', style: TextStyle(fontSize: 12)),
                backgroundColor: AppTheme.surface,
                onPressed: () => _urlController.text = 'http://192.168.100.136:8080',
              ),
              ActionChip(
                label: const Text('Tailscale (100.84.254.110:8080)', style: TextStyle(fontSize: 12)),
                backgroundColor: AppTheme.surface,
                onPressed: () => _urlController.text = 'http://100.84.254.110:8080',
              ),
            ],
          ),
          const SizedBox(height: 20),
          const Text('6-Digit PIN', style: TextStyle(color: AppTheme.textPrimary, fontSize: 13, fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          TextField(
            controller: _pinController,
            keyboardType: TextInputType.number,
            maxLength: 6,
            textAlign: TextAlign.center,
            style: const TextStyle(color: AppTheme.textPrimary, fontSize: 28, letterSpacing: 8, fontWeight: FontWeight.bold),
            decoration: InputDecoration(
              hintText: '000000',
              counterText: '',
              filled: true,
              fillColor: AppTheme.surface,
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppTheme.surfaceBorder)),
              enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppTheme.surfaceBorder)),
              focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppTheme.primaryLight)),
            ),
          ),
          const SizedBox(height: 32),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.primary,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            onPressed: _loading ? null : _handleManualConnect,
            child: _loading
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                : const Text('Connect to Muse', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
          ),
        ],
      ),
    );
  }
}
