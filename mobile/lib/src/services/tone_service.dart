import 'dart:math';
import 'dart:typed_data';

import 'package:audioplayers/audioplayers.dart';

/// One synthesis segment: a set of frequencies played together (empty = silence)
/// for [ms] milliseconds.
class _Seg {
  const _Seg(this.freqs, this.ms);
  final List<double> freqs;
  final int ms;
}

/// Synthesises and plays short audio cues locally:
///  * DTMF key tones (standard dual-tone pairs) for keypad feedback.
///  * A soft outgoing ringback ("do · do · do") while a call is ringing.
///
/// Tones are generated as in-memory 16-bit PCM WAV buffers (with a small
/// fade envelope so they sound like clean beeps, not clicky "tu" bursts), so no
/// asset files are needed and it works on mobile + web.
class ToneService {
  ToneService();

  final AudioPlayer _dtmf = AudioPlayer(playerId: 'enjoys_dtmf');
  final AudioPlayer _ring = AudioPlayer(playerId: 'enjoys_ringback');
  final Map<String, Uint8List> _cache = {};
  bool _ringing = false;

  // Standard DTMF dual-tone frequency pairs (Hz).
  static const Map<String, List<double>> _dtmf2 = {
    '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
    '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
    '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
    '*': [941, 1209], '0': [941, 1336], '#': [941, 1477],
    '+': [941, 1336],
  };

  /// Play the dual-tone for a keypad key. No-op for unknown keys.
  Future<void> playDtmf(String key) async {
    final freqs = _dtmf2[key];
    if (freqs == null) return;
    final bytes = _cache.putIfAbsent('d$key', () => _wav([_Seg(freqs, 150)]));
    try {
      await _dtmf.stop();
      await _dtmf.play(BytesSource(bytes), mode: PlayerMode.lowLatency);
    } catch (_) {
      // Audio is best-effort feedback; never let it break the dialer.
    }
  }

  /// Start the looping outgoing ringback beep. Safe to call repeatedly.
  Future<void> startRingback() async {
    if (_ringing) return;
    _ringing = true;
    final bytes = _cache.putIfAbsent(
      'rb',
      () => _wav(const [
        _Seg([480], 150), _Seg([], 110),
        _Seg([480], 150), _Seg([], 110),
        _Seg([480], 150), _Seg([], 1100),
      ]),
    );
    try {
      await _ring.setReleaseMode(ReleaseMode.loop);
      await _ring.stop();
      await _ring.play(BytesSource(bytes));
    } catch (_) {}
  }

  /// Stop the ringback beep.
  Future<void> stopRingback() async {
    if (!_ringing) return;
    _ringing = false;
    try {
      await _ring.stop();
    } catch (_) {}
  }

  void dispose() {
    _dtmf.dispose();
    _ring.dispose();
  }

  // ── WAV synthesis (16-bit mono PCM) ──────────────────────────────────────
  Uint8List _wav(List<_Seg> segs, {int rate = 16000}) {
    var total = 0;
    for (final s in segs) {
      total += (rate * s.ms / 1000).round();
    }
    final pcm = Int16List(total);
    final fade = (rate * 0.008).round(); // ~8ms attack/decay
    var idx = 0;
    for (final s in segs) {
      final n = (rate * s.ms / 1000).round();
      for (var i = 0; i < n; i++) {
        double v = 0;
        if (s.freqs.isNotEmpty) {
          for (final f in s.freqs) {
            v += sin(2 * pi * f * i / rate);
          }
          v /= s.freqs.length;
          double env = 1;
          if (i < fade) {
            env = i / fade;
          } else if (i > n - fade) {
            env = (n - i) / fade;
          }
          v *= env * 0.35; // gentle amplitude
        }
        pcm[idx++] = (v * 32767).round().clamp(-32768, 32767);
      }
    }
    return _encodeWav(pcm, rate);
  }

  Uint8List _encodeWav(Int16List pcm, int rate) {
    final dataBytes = pcm.lengthInBytes;
    final out = BytesBuilder();
    void str(String s) => out.add(s.codeUnits);
    void u32(int v) =>
        out.add([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]);
    void u16(int v) => out.add([v & 0xff, (v >> 8) & 0xff]);

    str('RIFF');
    u32(36 + dataBytes);
    str('WAVE');
    str('fmt ');
    u32(16); // fmt chunk size
    u16(1); // PCM
    u16(1); // mono
    u32(rate);
    u32(rate * 2); // byte rate (mono, 16-bit)
    u16(2); // block align
    u16(16); // bits per sample
    str('data');
    u32(dataBytes);

    final bd = ByteData(dataBytes);
    for (var i = 0; i < pcm.length; i++) {
      bd.setInt16(i * 2, pcm[i], Endian.little);
    }
    out.add(bd.buffer.asUint8List());
    return out.toBytes();
  }
}
