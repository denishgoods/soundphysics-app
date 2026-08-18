// sp/dsp.h — framework-free DSP primitives for the Sound Physics core.
// Plain C++17, no dependencies. Same blocks run on iOS, macOS, or a Daisy Seed.
#pragma once
#include <cmath>
#include <cstdint>
#include <vector>
#include <algorithm>

namespace sp {

constexpr float kPi = 3.14159265358979323846f;
constexpr float kTwoPi = 2.0f * kPi;

// ---------- deterministic RNG (xorshift) ----------
struct Rng {
  uint32_t s;
  explicit Rng(uint32_t seed = 0x9e3779b9u) : s(seed ? seed : 1u) {}
  uint32_t next() { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return s; }
  float uni() { return (next() >> 8) * (1.0f / 16777216.0f); }          // [0,1)
  float bi()  { return uni() * 2.0f - 1.0f; }                            // [-1,1)
  float range(float a, float b) { return a + (b - a) * uni(); }
};

// ---------- one-pole ----------
struct OnePoleLP {
  float z = 0, k = 0.2f;
  void setK(float kk) { k = kk; }
  float process(float x) { z += k * (x - z); return z; }
};

// ---------- RBJ biquad ----------
struct Biquad {
  float b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
  float z1 = 0, z2 = 0;

  float process(float x) {
    float y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    return y;
  }
  void reset() { z1 = z2 = 0; }

  void lowpass(float fs, float f, float Q) {
    float w = kTwoPi * f / fs, c = std::cos(w), s = std::sin(w), al = s / (2 * Q);
    float a0 = 1 + al;
    b0 = (1 - c) / 2 / a0; b1 = (1 - c) / a0; b2 = b0;
    a1 = -2 * c / a0; a2 = (1 - al) / a0;
  }
  void highpass(float fs, float f, float Q) {
    float w = kTwoPi * f / fs, c = std::cos(w), s = std::sin(w), al = s / (2 * Q);
    float a0 = 1 + al;
    b0 = (1 + c) / 2 / a0; b1 = -(1 + c) / a0; b2 = b0;
    a1 = -2 * c / a0; a2 = (1 - al) / a0;
  }
  // RBJ shelving filter, slope S = 1
  void shelf(float fs, float f, float dB, bool high) {
    float A = std::pow(10.0f, dB / 40.0f);
    float w = kTwoPi * f / fs, c = std::cos(w), s = std::sin(w);
    float alpha = (s / 2) * std::sqrt(2.0f);
    float k = 2 * std::sqrt(A) * alpha;
    float a0;
    if (high) {
      a0 = (A + 1) - (A - 1) * c + k;
      b0 = A * ((A + 1) + (A - 1) * c + k) / a0;
      b1 = -2 * A * ((A - 1) + (A + 1) * c) / a0;
      b2 = A * ((A + 1) + (A - 1) * c - k) / a0;
      a1 = 2 * ((A - 1) - (A + 1) * c) / a0;
      a2 = ((A + 1) - (A - 1) * c - k) / a0;
    } else {
      a0 = (A + 1) + (A - 1) * c + k;
      b0 = A * ((A + 1) - (A - 1) * c + k) / a0;
      b1 = 2 * A * ((A - 1) - (A + 1) * c) / a0;
      b2 = A * ((A + 1) - (A - 1) * c - k) / a0;
      a1 = -2 * ((A - 1) + (A + 1) * c) / a0;
      a2 = ((A + 1) + (A - 1) * c - k) / a0;
    }
  }
  void peaking(float fs, float f, float dB, float Q) {
    float A = std::pow(10.0f, dB / 40.0f);
    float w = kTwoPi * f / fs, c = std::cos(w), s = std::sin(w), al = s / (2 * Q);
    float a0 = 1 + al / A;
    b0 = (1 + al * A) / a0; b1 = -2 * c / a0; b2 = (1 - al * A) / a0;
    a1 = b1; a2 = (1 - al / A) / a0;
  }
};

// ---------- fractional delay line ----------
struct DelayLine {
  std::vector<float> buf;
  int w = 0;
  void init(int maxSamples) { buf.assign((size_t)maxSamples, 0.0f); w = 0; }
  void write(float x) { buf[(size_t)w] = x; if (++w >= (int)buf.size()) w = 0; }
  float read(float delaySamples) const {
    float rp = (float)w - delaySamples;
    const int n = (int)buf.size();
    while (rp < 0) rp += (float)n;
    int i0 = (int)rp;
    float fr = rp - (float)i0;
    int i1 = i0 + 1; if (i1 >= n) i1 -= n;
    if (i0 >= n) i0 -= n;
    return buf[(size_t)i0] * (1 - fr) + buf[(size_t)i1] * fr;
  }
};

// ---------- tape transfer curve: asymmetric tanh -> even harmonics ----------
inline float tapeShape(float x, float g = 1.5f, float bias = 0.12f) {
  const float norm = std::max(std::abs(std::tanh(g + bias) - std::tanh(bias)),
                              std::abs(std::tanh(-g + bias) - std::tanh(bias)));
  return (std::tanh(g * x + bias) - std::tanh(bias)) / norm;
}
inline float softClip(float x, float amount = 1.3f) {
  return std::tanh(x * amount) / std::tanh(amount);
}

// ---------- 8-line FDN reverb (Householder), warm damped tail ----------
struct FdnReverb {
  static constexpr int N = 8;
  DelayLine d[N];
  OnePoleLP damp[N];
  float g[N];
  float lenS[N];
  Biquad inHp;
  float fs = 48000;

  void init(float sampleRate, float t60 = 3.2f, float dampK = 0.28f) {
    fs = sampleRate;
    const float lens[N] = { 0.0297f, 0.0371f, 0.0411f, 0.0437f,
                            0.0533f, 0.0623f, 0.0779f, 0.0937f };
    for (int i = 0; i < N; i++) {
      lenS[i] = lens[i] * fs;
      d[i].init((int)lenS[i] + 8);
      g[i] = std::pow(10.0f, -3.0f * lens[i] / t60);
      damp[i].setK(dampK);
    }
    inHp.highpass(fs, 120, 0.5f);
  }

  void process(float inL, float inR, float& outL, float& outR) {
    float in = inHp.process((inL + inR) * 0.5f);
    float v[N], sum = 0;
    for (int i = 0; i < N; i++) { v[i] = d[i].read(lenS[i]); sum += v[i]; }
    const float hh = 2.0f / N; // Householder: y_i = x_i - (2/N) * sum
    outL = outR = 0;
    for (int i = 0; i < N; i++) {
      float fb = v[i] - hh * sum;
      float x = in + damp[i].process(fb) * g[i];
      d[i].write(x);
      if (i & 1) outR += v[i]; else outL += v[i];
    }
    outL *= 0.5f; outR *= 0.5f;
  }
};

} // namespace sp
