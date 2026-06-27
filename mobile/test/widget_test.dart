import 'package:enjoys_voice/src/ui/widgets/brand_mark.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('BrandMark renders', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: Center(child: BrandMark()))),
    );
    expect(find.byType(BrandMark), findsOneWidget);
  });
}
