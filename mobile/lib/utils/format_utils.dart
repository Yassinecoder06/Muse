class FormatUtils {
  /// Converts rich HTML from Muse Web into clean Markdown for display in flutter_markdown
  static String htmlToMarkdown(String raw) {
    if (raw.isEmpty) return '';
    if (!raw.contains('<') && !raw.contains('>')) return raw;

    String s = raw;

    // Remove style and script tags
    s = s.replaceAll(RegExp(r'<style[^>]*>[\s\S]*?</style>', caseSensitive: false), '');
    s = s.replaceAll(RegExp(r'<script[^>]*>[\s\S]*?</script>', caseSensitive: false), '');

    // Headers
    s = s.replaceAllMapped(RegExp(r'<h1[^>]*>(.*?)</h1>', caseSensitive: false, dotAll: true), (m) => '\n\n# ${m[1]?.trim()}\n\n');
    s = s.replaceAllMapped(RegExp(r'<h2[^>]*>(.*?)</h2>', caseSensitive: false, dotAll: true), (m) => '\n\n## ${m[1]?.trim()}\n\n');
    s = s.replaceAllMapped(RegExp(r'<h3[^>]*>(.*?)</h3>', caseSensitive: false, dotAll: true), (m) => '\n\n### ${m[1]?.trim()}\n\n');
    s = s.replaceAllMapped(RegExp(r'<h4[^>]*>(.*?)</h4>', caseSensitive: false, dotAll: true), (m) => '\n\n#### ${m[1]?.trim()}\n\n');

    // Horizontal rules
    s = s.replaceAll(RegExp(r'<hr\s*/?>', caseSensitive: false), '\n\n---\n\n');

    // Bold & Italics
    s = s.replaceAllMapped(RegExp(r'<strong[^>]*>(.*?)</strong>', caseSensitive: false, dotAll: true), (m) => '**${m[1]?.trim()}**');
    s = s.replaceAllMapped(RegExp(r'<b[^>]*>(.*?)</b>', caseSensitive: false, dotAll: true), (m) => '**${m[1]?.trim()}**');
    s = s.replaceAllMapped(RegExp(r'<em[^>]*>(.*?)</em>', caseSensitive: false, dotAll: true), (m) => '*${m[1]?.trim()}*');
    s = s.replaceAllMapped(RegExp(r'<i[^>]*>(.*?)</i>', caseSensitive: false, dotAll: true), (m) => '*${m[1]?.trim()}*');

    // Blockquotes
    s = s.replaceAllMapped(RegExp(r'<blockquote[^>]*>(.*?)</blockquote>', caseSensitive: false, dotAll: true), (m) => '\n> ${m[1]?.trim()}\n');

    // Code blocks & inline code
    s = s.replaceAllMapped(RegExp(r'<pre><code[^>]*>(.*?)</code></pre>', caseSensitive: false, dotAll: true), (m) => '\n```\n${m[1]?.trim()}\n```\n');
    s = s.replaceAllMapped(RegExp(r'<code[^>]*>(.*?)</code>', caseSensitive: false, dotAll: true), (m) => '`${m[1]?.trim()}`');

    // Tables
    s = s.replaceAllMapped(RegExp(r'<table[^>]*>([\s\S]*?)</table>', caseSensitive: false), (m) {
      final tableContent = m[1] ?? '';
      final rows = <List<String>>[];

      final rowRegex = RegExp(r'<tr[^>]*>([\s\S]*?)</tr>', caseSensitive: false);
      for (final rowMatch in rowRegex.allMatches(tableContent)) {
        final cellRegex = RegExp(r'<(?:th|td)[^>]*>([\s\S]*?)</(?:th|td)>', caseSensitive: false);
        final cells = <String>[];
        for (final cellMatch in cellRegex.allMatches(rowMatch[1] ?? '')) {
          var cellText = (cellMatch[1] ?? '')
              .replaceAll(RegExp(r'<[^>]*>'), ' ')
              .replaceAll(RegExp(r'\s+'), ' ')
              .trim();
          cells.add(cellText);
        }
        if (cells.isNotEmpty) rows.add(cells);
      }

      if (rows.isEmpty) return '';

      final maxCols = rows.map((r) => r.length).reduce((a, b) => a > b ? a : b);
      final md = StringBuffer('\n\n');

      // Header row
      final header = rows.first;
      md.write('| ');
      for (var i = 0; i < maxCols; i++) {
        md.write(i < header.length ? header[i] : '');
        md.write(' | ');
      }
      md.write('\n| ');
      for (var i = 0; i < maxCols; i++) {
        md.write('--- | ');
      }
      md.write('\n');

      // Body rows
      for (var r = 1; r < rows.length; r++) {
        final row = rows[r];
        md.write('| ');
        for (var i = 0; i < maxCols; i++) {
          md.write(i < row.length ? row[i] : '');
          md.write(' | ');
        }
        md.write('\n');
      }
      md.write('\n');
      return md.toString();
    });

    // Lists
    s = s.replaceAllMapped(RegExp(r'<li[^>]*>(.*?)</li>', caseSensitive: false, dotAll: true), (m) => '\n* ${m[1]?.trim()}');
    s = s.replaceAll(RegExp(r'</?(?:ul|ol)[^>]*>', caseSensitive: false), '\n');

    // Paragraphs & Breaks
    s = s.replaceAll(RegExp(r'<br\s*/?>', caseSensitive: false), '\n');
    s = s.replaceAll(RegExp(r'<p[^>]*>', caseSensitive: false), '\n\n');
    s = s.replaceAll(RegExp(r'</p>', caseSensitive: false), '');

    // Strip remaining tags
    s = s.replaceAll(RegExp(r'<[^>]*>'), '');

    // HTML entities
    s = s.replaceAll('&nbsp;', ' ')
        .replaceAll('&amp;', '&')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&#39;', "'");

    // Clean multiple newlines
    s = s.replaceAll(RegExp(r'\n{3,}'), '\n\n');

    return s.trim();
  }

  /// Extracts clean preview snippet without HTML or Markdown artifacts
  static String htmlToPlainText(String raw) {
    if (raw.isEmpty) return '';
    return raw
        .replaceAll(RegExp(r'<style[^>]*>[\s\S]*?</style>', caseSensitive: false), '')
        .replaceAll(RegExp(r'<script[^>]*>[\s\S]*?</script>', caseSensitive: false), '')
        .replaceAll(RegExp(r'<br\s*/?>', caseSensitive: false), ' ')
        .replaceAll(RegExp(r'</p>|</div>|</li>|</tr>', caseSensitive: false), ' ')
        .replaceAll(RegExp(r'<[^>]*>'), ' ')
        .replaceAll('&nbsp;', ' ')
        .replaceAll('&amp;', '&')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&#39;', "'")
        .replaceAll(RegExp(r'[ \t]+'), ' ')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
  }
}
