import 'package:flutter_test/flutter_test.dart';
import 'package:muse_mobile/utils/format_utils.dart';

void main() {
  test('keeps images and links when converting web HTML to Markdown', () {
    const html = '<p>See <a href="https://example.com/doc" target="_blank">the <b>doc</b></a></p>'
        '<p><img src="/api/images/abc-123" alt="chart"></p>';
    final md = FormatUtils.htmlToMarkdown(html);
    expect(md, contains('![chart](/api/images/abc-123)'));
    expect(md, contains('[the **doc**](https://example.com/doc)'));
  });

  test('drops images without a source', () {
    expect(FormatUtils.htmlToMarkdown('<p>a<img alt="x">b</p>'), 'ab');
  });
}
