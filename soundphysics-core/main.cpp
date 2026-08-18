// main.cpp — CLI test harness for the Sound Physics core.
// Usage:
//   ./daydream                 -> synthesizes a warm test source, renders 30s
//   ./daydream input.wav 45    -> uses your recording, renders 45s
#include "sp/daydream.h"
#include "sp/wav.h"
#include <cstdio>
#include <cstdlib>

static std::vector<float> makeTestSource(float fs) {
  // a soft hummed-chord pluck: three partials, slow vibrato, breathy noise
  const float dur = 2.5f;
  const int n = (int)(fs * dur);
  std::vector<float> out((size_t)n, 0.0f);
  const float freqs[3] = { 220.0f, 277.18f, 329.63f };
  sp::Rng rng(42);
  float noiseLp = 0;
  for (int i = 0; i < n; i++) {
    float t = i / fs;
    float env = std::exp(-t * 1.1f) * (1 - std::exp(-t * 40.0f));
    float vib = 1 + 0.004f * std::sin(sp::kTwoPi * 4.7f * t);
    float s = 0;
    for (int k = 0; k < 3; k++) {
      s += std::sin(sp::kTwoPi * freqs[k] * vib * t) * (0.32f - 0.07f * k);
      s += std::sin(sp::kTwoPi * freqs[k] * 2 * t) * 0.05f;
    }
    noiseLp += 0.08f * (rng.bi() - noiseLp);
    s += noiseLp * 0.15f * env;
    out[(size_t)i] = s * env * 0.5f;
  }
  return out;
}

int main(int argc, char** argv) {
  const float fs = 48000;
  float seconds = 30;
  std::vector<float> source;

  if (argc > 1) {
    int rate = 0;
    if (!sp::readWavMono(argv[1], source, rate)) {
      std::fprintf(stderr, "could not read %s\n", argv[1]);
      return 1;
    }
    std::printf("source: %s (%zu samples @ %d)\n", argv[1], source.size(), rate);
    if (argc > 2) seconds = (float)std::atof(argv[2]);
  } else {
    source = makeTestSource(fs);
    std::printf("source: synthesized test chord (2.5s)\n");
  }

  sp::DaydreamEngine engine;
  engine.init(fs);
  engine.addVoice(source, 1234);
  engine.addVoice(source, 9876);

  const int n = (int)(fs * seconds);
  std::vector<float> L((size_t)n), R((size_t)n);
  float peak = 0;
  double rmsAcc = 0;
  for (int i = 0; i < n; i++) {
    float l, r;
    engine.process(l, r);
    // master safety: trim + soft clip, same as the web app
    l = sp::softClip(l * 0.8f);
    r = sp::softClip(r * 0.8f);
    L[(size_t)i] = l; R[(size_t)i] = r;
    float a = std::max(std::abs(l), std::abs(r));
    if (a > peak) peak = a;
    rmsAcc += (double)l * l + (double)r * r;
    if (i % (int)(fs * 5) == (int)(fs * 5) - 1) {
      std::printf("  t=%2ds  peak=%.3f  rms=%.4f\n",
                  (i + 1) / (int)fs, peak,
                  std::sqrt(rmsAcc / ((i + 1) * 2.0)));
    }
  }

  if (!sp::writeWav16("daydream_out.wav", L, R, (int)fs)) {
    std::fprintf(stderr, "write failed\n");
    return 1;
  }
  std::printf("wrote daydream_out.wav (%.0fs, peak %.3f)\n", seconds, peak);
  return 0;
}
