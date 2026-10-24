#!/usr/bin/env python3
"""Generate an original three-strike bell. No runtime dependencies or downloads."""
import math
import struct
import sys
import wave
from pathlib import Path

output = Path(sys.argv[1])
output.parent.mkdir(parents=True, exist_ok=True)
sample_rate = 44100
duration = 1.7
samples = []
for index in range(int(duration * sample_rate)):
    t = index / sample_rate
    value = 0.0
    for strike in (0.0, 0.38, 0.76):
        local = t - strike
        if 0 <= local <= 0.85:
            envelope = min(1.0, local / 0.006) * math.exp(-local * 8)
            value += envelope * (
                0.4 * math.sin(2 * math.pi * 880 * local)
                + 0.15 * math.sin(2 * math.pi * 1320 * local)
                + 0.06 * math.sin(2 * math.pi * 1760 * local)
            )
    samples.append(struct.pack("<h", int(max(-0.95, min(0.95, value)) * 32767)))
with wave.open(str(output), "wb") as wav:
    wav.setnchannels(1)
    wav.setsampwidth(2)
    wav.setframerate(sample_rate)
    wav.writeframes(b"".join(samples))
