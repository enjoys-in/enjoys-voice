"""Generate ringtone and hold music WAV files for FreeSWITCH (8kHz, 16-bit mono)"""
import wave, struct, math, os

SAMPLE_RATE = 8000
CHANNELS = 1
SAMPLE_WIDTH = 2  # 16-bit

def write_wav(filename, samples):
    with wave.open(filename, 'w') as f:
        f.setnchannels(CHANNELS)
        f.setsampwidth(SAMPLE_WIDTH)
        f.setframerate(SAMPLE_RATE)
        f.writeframes(struct.pack(f'<{len(samples)}h', *samples))
    print(f"  Created: {filename} ({len(samples)/SAMPLE_RATE:.1f}s)")

def tone(freq, duration_sec, volume=0.5):
    """Generate a pure sine tone"""
    samples = []
    for i in range(int(SAMPLE_RATE * duration_sec)):
        t = i / SAMPLE_RATE
        val = int(volume * 32767 * math.sin(2 * math.pi * freq * t))
        samples.append(val)
    return samples

def silence(duration_sec):
    return [0] * int(SAMPLE_RATE * duration_sec)

def mix(samples1, samples2):
    """Mix two sample lists together"""
    length = max(len(samples1), len(samples2))
    result = []
    for i in range(length):
        s1 = samples1[i] if i < len(samples1) else 0
        s2 = samples2[i] if i < len(samples2) else 0
        mixed = int((s1 + s2) / 2)
        result.append(max(-32767, min(32767, mixed)))
    return result

def fade_in(samples, duration_sec=0.05):
    fade_len = int(SAMPLE_RATE * duration_sec)
    for i in range(min(fade_len, len(samples))):
        samples[i] = int(samples[i] * (i / fade_len))
    return samples

def fade_out(samples, duration_sec=0.05):
    fade_len = int(SAMPLE_RATE * duration_sec)
    start = len(samples) - fade_len
    for i in range(max(0, start), len(samples)):
        factor = (len(samples) - i) / fade_len
        samples[i] = int(samples[i] * factor)
    return samples

# ─── Ringback Tone (Standard North American: 440+480Hz, 2s on, 4s off) ───
def generate_ringback():
    print("Generating ringback tone (30s)...")
    samples = []
    for _ in range(5):  # 5 cycles = 30 seconds
        ring = mix(tone(440, 2.0, 0.3), tone(480, 2.0, 0.3))
        samples.extend(ring)
        samples.extend(silence(4.0))
    write_wav('ringtones/ringback.wav', samples)

# ─── Indian Ringback Tone (400Hz, 0.4s on, 0.2s off, 0.4s on, 2s off) ───
def generate_ringback_in():
    print("Generating Indian ringback tone (30s)...")
    samples = []
    for _ in range(8):
        ring1 = tone(400, 0.4, 0.4)
        gap1 = silence(0.2)
        ring2 = tone(400, 0.4, 0.4)
        gap2 = silence(2.0)
        samples.extend(ring1 + gap1 + ring2 + gap2)
    write_wav('ringtones/ringback_in.wav', samples)

# ─── Hold Music 1: Gentle melody (simple arpeggio pattern) ───
def generate_hold_music_1():
    print("Generating hold music 1 - gentle melody (60s)...")
    # C major pentatonic: C4, D4, E4, G4, A4
    notes = [262, 294, 330, 392, 440, 392, 330, 294]
    samples = []
    note_dur = 0.5
    for loop in range(15):  # 15 * 4s = 60s
        for note_freq in notes:
            note_samples = tone(note_freq, note_dur, 0.25)
            fade_in(note_samples, 0.02)
            fade_out(note_samples, 0.1)
            samples.extend(note_samples)
    write_wav('music/hold_music_1.wav', samples)

# ─── Hold Music 2: Calm ambient (low chord pad) ───
def generate_hold_music_2():
    print("Generating hold music 2 - ambient pad (60s)...")
    # C major chord: C3, E3, G3 slowly pulsing
    samples = []
    total_dur = 60.0
    for i in range(int(SAMPLE_RATE * total_dur)):
        t = i / SAMPLE_RATE
        # Slow volume modulation
        vol = 0.15 + 0.1 * math.sin(2 * math.pi * 0.1 * t)
        # Chord tones
        c3 = math.sin(2 * math.pi * 131 * t)
        e3 = math.sin(2 * math.pi * 165 * t)
        g3 = math.sin(2 * math.pi * 196 * t)
        val = int(vol * 32767 * (c3 + e3 * 0.7 + g3 * 0.5) / 2.2)
        samples.append(max(-32767, min(32767, val)))
    write_wav('music/hold_music_2.wav', samples)

# ─── Hold Music 3: Elevator jazz-like pattern ───
def generate_hold_music_3():
    print("Generating hold music 3 - jazz pattern (60s)...")
    # Cmaj7 arpeggio: C4, E4, G4, B4
    notes = [262, 330, 392, 494, 392, 330, 262, 330, 392, 440, 392, 330]
    samples = []
    note_dur = 0.4
    gap_dur = 0.1
    for _ in range(12):
        for note_freq in notes:
            note_samples = tone(note_freq, note_dur, 0.2)
            fade_in(note_samples, 0.03)
            fade_out(note_samples, 0.08)
            samples.extend(note_samples)
            samples.extend(silence(gap_dur))
    write_wav('music/hold_music_3.wav', samples)

# ─── Caller Tune: Pleasant waiting melody ───
def generate_caller_tune():
    print("Generating caller tune (30s)...")
    # A pleasant short melody loop
    melody = [
        (392, 0.3), (440, 0.3), (494, 0.6), (440, 0.3),
        (392, 0.3), (330, 0.6), (294, 0.3), (330, 0.3),
        (392, 0.6), (330, 0.6), (294, 0.3), (262, 0.9),
    ]
    samples = []
    for _ in range(5):  # Loop 5 times ~30s
        for freq, dur in melody:
            note_samples = tone(freq, dur, 0.3)
            fade_in(note_samples, 0.02)
            fade_out(note_samples, 0.05)
            samples.extend(note_samples)
        samples.extend(silence(0.5))
    write_wav('ringtones/caller_tune.wav', samples)

if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print("=== Generating VoIP Sound Files ===\n")
    generate_ringback()
    generate_ringback_in()
    generate_hold_music_1()
    generate_hold_music_2()
    generate_hold_music_3()
    generate_caller_tune()
    print("\n✅ All sound files generated!")
