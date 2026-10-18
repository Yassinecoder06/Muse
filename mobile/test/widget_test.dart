import 'package:flutter_test/flutter_test.dart';
import 'package:muse_mobile/main.dart';

void main() {
  testWidgets('Muse app loads smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(const MuseMobileApp(initialPaired: false));
    expect(find.text('Pair with Muse Desktop'), findsOneWidget);
  });
}
