import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import 'bip_voice_sheet.dart';

class BipCompanionButton extends StatefulWidget {
  final VoidCallback? onCustomTap;

  const BipCompanionButton({super.key, this.onCustomTap});

  @override
  State<BipCompanionButton> createState() => _BipCompanionButtonState();
}

class _BipCompanionButtonState extends State<BipCompanionButton>
    with SingleTickerProviderStateMixin {
  late AnimationController _pulseController;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2000),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _pulseController,
      builder: (context, child) {
        final glow = 0.3 + (_pulseController.value * 0.4);

        return Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: widget.onCustomTap ?? () => BipVoiceSheet.show(context),
            borderRadius: BorderRadius.circular(28),
            splashColor: const Color(0xFF00E5FF).withValues(alpha: 0.3),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFF2E1A47), Color(0xFF1A1C29)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(28),
                border: Border.all(
                  color: const Color(0xFF00E5FF).withValues(alpha: glow),
                  width: 1.5,
                ),
                boxShadow: [
                  BoxShadow(
                    color: const Color(0xFF00E5FF).withValues(alpha: glow * 0.5),
                    blurRadius: 10,
                    spreadRadius: 1,
                  ),
                ],
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  // Cute Mini Bip Head
                  Container(
                    width: 26,
                    height: 24,
                    decoration: BoxDecoration(
                      color: const Color(0xFF1E202B),
                      borderRadius: BorderRadius.circular(7),
                      border: Border.all(
                        color: const Color(0xFF00E5FF).withValues(alpha: 0.8),
                        width: 1.2,
                      ),
                    ),
                    child: Stack(
                      alignment: Alignment.center,
                      children: [
                        // Antenna Dot
                        Positioned(
                          top: 2,
                          child: Container(
                            width: 3,
                            height: 3,
                            decoration: const BoxDecoration(
                              color: Color(0xFF00E5FF),
                              shape: BoxShape.circle,
                            ),
                          ),
                        ),
                        // Eyes
                        Positioned(
                          top: 8,
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Container(
                                width: 4,
                                height: 4,
                                decoration: BoxDecoration(
                                  color: const Color(0xFF00E5FF),
                                  borderRadius: BorderRadius.circular(1.5),
                                ),
                              ),
                              const SizedBox(width: 5),
                              Container(
                                width: 4,
                                height: 4,
                                decoration: BoxDecoration(
                                  color: const Color(0xFF00E5FF),
                                  borderRadius: BorderRadius.circular(1.5),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  const Text(
                    'Talk to Bip',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.bold,
                      color: AppTheme.textPrimary,
                      letterSpacing: 0.2,
                    ),
                  ),
                  const SizedBox(width: 4),
                  const Icon(
                    Icons.mic_rounded,
                    size: 16,
                    color: Color(0xFF00E5FF),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}
