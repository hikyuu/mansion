void main() {
  const magnet =
      'magnet:?xt=urn:btih:819e60f5927dd10929b5ef0f06e86f81555a4817&dn=[javdb.com]SNOS-307-UC.无码破解.torrent';

  void probe(String label, Object? Function() fn) {
    try {
      print('$label => ${fn()}');
    } catch (e) {
      print('$label => FAIL: $e');
    }
  }

  // 1. 完全复刻 parseMagnet 的解码逻辑
  final query = magnet.contains('?') ? magnet.substring(magnet.indexOf('?') + 1) : magnet;
  for (final part in query.split('&')) {
    if (part.isEmpty) continue;
    final eq = part.indexOf('=');
    if (eq < 0) continue;
    final key = part.substring(0, eq);
    final raw = part.substring(eq + 1).replaceAll('+', ' ');
    probe('decodeComponent[$key]', () => Uri.decodeComponent(raw));
  }

  // 2. 其它可能抛同款错误的调用
  probe('Uri.parse(magnet)', () => Uri.parse(magnet));
  probe('Uri.tryParse(magnet)', () => Uri.tryParse(magnet));
  probe('Uri.parse(magnet).queryParameters', () => Uri.parse(magnet).queryParameters);
  probe('Uri.parse(magnet).pathSegments', () => Uri.parse(magnet).pathSegments);
  probe('Uri.parse(magnet).toString()', () => Uri.parse(magnet).toString());
  probe('Uri.decodeFull(magnet)', () => Uri.decodeFull(magnet));
  probe('Uri.decodeComponent(中文)', () => Uri.decodeComponent('无码破解'));
  probe('Uri.parse(中文)', () => Uri.parse('http://a/无码破解'));
  probe('Uri.parse([x])', () => Uri.parse('http://a/?dn=[x]'));
  probe('decodeComponent(坏 %)', () => Uri.decodeComponent('100%'));
  probe('Uri.parse(坏 %)', () => Uri.parse('http://a/?dn=100%'));
}
