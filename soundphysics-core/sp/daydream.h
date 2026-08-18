// sp/daydream.h — the Daydream granular engine, ported 1:1 from the web app.
// Every constant here was tuned by ear in the browser version; treat them as spec.
#pragma once
#include "dsp.h"

namespace sp {

// ---------------- parameters (mirror the web knobs) ----------------
struct DaydreamParams {
  float density  = 1.3f;   // grain birth rate multiplier
  float shimmer  = 0.65f;  // probability weight of octave-up grains
  float delayMix = 0.4f;   // per-voice tape delay level
  float verbWet  = 0.7f;   // reverb amount
  float dust     = 0.25f;  // hiss + crackle level
  float satDrive = 1.6f;   // tape saturation drive
  float volume   = 1.0f;
};

// ---------------- one playing grain ----------------
struct Grain {
  bool active = false;
  double pos = 0, pos2 = 0;        // deck 1 / deck 2 read positions (samples)
  double rate = 1, rate2 = 1;
  double t = 0;                     // elapsed samples
  double att = 0, sus = 0, rel = 0; // envelope, samples
  float vol = 0.2f;
  float panL = 0.7f, panR = 0.7f;
  float warblePh = 0, warbleInc = 0, warbleDepth = 0;
  float flutterPh = 0, flutterInc = 0;
  double deck2Start = 0;            // deck 2 enters a touch late
  bool shimmerLp = false;
  OnePoleLP lp;                     // rounds shimmer tops
};

// ---------------- a voice: one recording + its private tape fx ----------------
struct DreamVoice {
  std::vector<float> src;   // mono, loop-crossfaded
  int loopEnd = 0;
  Rng rng;

  static constexpr int kMaxGrains = 24;
  Grain grains[kMaxGrains];
  double nextGrainIn = 0;   // samples until next grain birth
  float densPhase = 0;

  // sun-soaked chorus
  DelayLine chL, chR;
  float chLfoPh = 0, chLfoInc = 0;

  // private tape delay
  DelayLine dlyL, dlyR;
  Biquad fbHp, fbLpF;
  float fbLpFreq = 4750;
  float delPhase = 0, delRate = 0, fbPhase = 0, vsPhase = 0;
  float dlyTime = 0.4f, fbAmt = 0.4f, verbSend = 0.8f;
  float fbStateL = 0, fbStateR = 0;

  // failure: gentle dips
  double nextDropIn = 0;
  float dropEnv = 1, dropTarget = 1;
  double dropRecoverIn = 0;

  float fs = 48000;
  float vol = 1;

  void init(float sampleRate, const std::vector<float>& mono, uint32_t seed) {
    fs = sampleRate;
    rng = Rng(seed);
    // seamless loop: equal-power crossfade head with tail (0.12s)
    src = mono;
    int fade = std::min((int)(fs * 0.12f), (int)src.size() / 4);
    for (int i = 0; i < fade; i++) {
      float w = (float)i / fade;
      float a = std::cos((1 - w) * kPi / 2), b = std::cos(w * kPi / 2);
      src[(size_t)i] = mono[(size_t)i] * a + mono[mono.size() - fade + i] * b;
    }
    loopEnd = (int)src.size() - fade;

    chL.init((int)(fs * 0.1f)); chR.init((int)(fs * 0.1f));
    chLfoInc = kTwoPi * rng.range(0.8f, 1.4f) / fs;
    dlyL.init((int)(fs * 2)); dlyR.init((int)(fs * 2));
    fbHp.highpass(fs, 220, 0.707f);
    fbLpFreq = rng.range(4000.0f, 5500.0f);
    fbLpF.lowpass(fs, fbLpFreq, 0.707f);
    delRate = rng.range(0.015f, 0.055f);
    delPhase = rng.uni() * kTwoPi;
    fbPhase = rng.uni() * kTwoPi;
    vsPhase = rng.uni() * kTwoPi;
    nextGrainIn = fs * 0.05;
    nextDropIn = fs * rng.range(8.0f, 24.0f);
  }

  float readSrc(double p) const {
    // linear interp with loop wrap inside [0, loopEnd)
    while (p >= loopEnd) p -= loopEnd;
    int i0 = (int)p;
    float fr = (float)(p - i0);
    int i1 = i0 + 1; if (i1 >= loopEnd) i1 = 0;
    return src[(size_t)i0] * (1 - fr) + src[(size_t)i1] * fr;
  }

  float pickRate(float shimmerKnob, bool& isShimmer) {
    isShimmer = false;
    float cents = rng.range(-7.0f, 7.0f);
    if (rng.uni() < shimmerKnob * 0.45f) {
      isShimmer = true;
      return 2.0f * std::pow(2.0f, cents / 1200.0f);
    }
    float r = rng.uni();
    float base = r < 0.6f ? 1.0f : 1.26f; // unison / major third (sunny)
    if (r > 0.9f) base = 1.498f;          // occasional fifth
    return base * std::pow(2.0f, cents / 1200.0f);
  }

  void spawnGrain(const DaydreamParams& P, float worldWow) {
    Grain* g = nullptr;
    for (auto& gr : grains) if (!gr.active) { g = &gr; break; }
    if (!g) return;

    float srcDur = (float)loopEnd / fs;
    float grainMax = std::max(10.0f, srcDur * 1.5f);
    float grainDur = 3.0f + rng.uni() * std::max(4.0f, std::min(grainMax - 3.0f, 7.0f));
    float att = 0.8f + rng.uni() * 1.4f;
    float vol = (0.16f + rng.uni() * 0.14f) * 0.72f; // two decks sum

    bool shim = false;
    float rate = pickRate(P.shimmer, shim);
    if (shim) {
      att = std::min(att * 2.2f, grainDur * 0.5f);
      vol *= 0.5f;
      g->lp.setK(1.0f - std::exp(-kTwoPi * 4200.0f / fs));
    }
    g->shimmerLp = shim;
    float rel = 2.0f + rng.uni() * 3.0f;
    float sus = std::max(0.2f, grainDur - att - rel);

    g->active = true;
    g->t = 0;
    g->att = att * fs; g->sus = sus * fs; g->rel = rel * fs;
    g->vol = vol;
    g->rate = rate;
    g->rate2 = rate * std::pow(2.0, rng.range(-4.0f, 4.0f) / 1200.0); // deck 2 detune
    double offset = rng.uni() * loopEnd;
    g->pos = offset; g->pos2 = offset;
    g->deck2Start = fs * (0.012 + rng.uni() * 0.014);
    // wow (weather can lean on it) + flutter
    g->warbleInc = kTwoPi * rng.range(0.25f, 1.15f) / fs;
    g->warbleDepth = (float)rate * 0.006f * worldWow;
    g->warblePh = rng.uni() * kTwoPi;
    g->flutterInc = kTwoPi * rng.range(5.0f, 8.0f) / fs;
    float pan = rng.range(-0.7f, 0.7f);
    g->panL = std::cos((pan + 1) * kPi / 4);
    g->panR = std::sin((pan + 1) * kPi / 4);
  }

  // renders one sample of this voice into dry L/R and verb-send L/R
  void process(const DaydreamParams& P, float worldDens, float worldWow,
               float& dryL, float& dryR, float& sendL, float& sendR) {
    // ---- grain scheduler ----
    if (--nextGrainIn <= 0) {
      spawnGrain(P, worldWow);
      densPhase += 0.0001f;
      float dens = (1.0f + 0.5f * std::sin(densPhase * 450.0f)) * P.density * worldDens;
      dens = std::max(0.1f, dens);
      float interval = (1.6f + rng.uni() * 2.9f) / dens; // AMB_INTERVAL / density
      nextGrainIn = (double)(interval * fs);
    }

    // ---- failure dips ----
    if (--nextDropIn <= 0) {
      dropTarget = 0.55f + rng.uni() * 0.15f;
      dropRecoverIn = fs * (0.3 + rng.uni() * 0.3);
      nextDropIn = fs * rng.range(8.0f, 24.0f);
    }
    if (dropRecoverIn > 0 && --dropRecoverIn <= 0) dropTarget = 1;
    dropEnv += (dropTarget - dropEnv) * (1.0f - std::exp(-1.0f / (0.1f * fs)));

    // ---- sum grains ----
    float mL = 0, mR = 0;
    for (auto& g : grains) {
      if (!g.active) continue;
      float env;
      if (g.t < g.att) env = (float)(g.t / g.att);
      else if (g.t < g.att + g.sus) env = 1;
      else {
        double rt = g.t - g.att - g.sus;
        if (rt >= g.rel) { g.active = false; continue; }
        env = 1 - (float)(rt / g.rel);
      }
      // flutter: fast tiny level trembling
      float flut = 1 + 0.06f * std::sin(g.flutterPh);
      g.flutterPh += g.flutterInc;
      // wow on pitch
      float wob = 1 + g.warbleDepth * std::sin(g.warblePh) / (float)g.rate;
      g.warblePh += g.warbleInc;

      float s = readSrc(g.pos);
      if (g.t > g.deck2Start) s += readSrc(g.pos2) * 0.55f; // dual-deck flange
      if (g.shimmerLp) s = g.lp.process(s);
      s *= g.vol * env * flut;
      mL += s * g.panL;
      mR += s * g.panR;

      g.pos += g.rate * wob;
      g.pos2 += g.rate2;
      g.t += 1;
    }
    mL *= dropEnv * vol;
    mR *= dropEnv * vol;

    // ---- chorus: direct 0.72 + modulated 18ms tap 0.45 ----
    chL.write(mL); chR.write(mR);
    float mod = std::sin(chLfoPh) * 0.0045f;
    chLfoPh += chLfoInc;
    float chTime = (0.018f + mod) * fs;
    float cL = mL * 0.72f + chL.read(chTime) * 0.45f;
    float cR = mR * 0.72f + chR.read(chTime) * 0.45f;

    // ---- private tape delay, everything drifting ----
    delPhase += delRate / fs;
    fbPhase += 0.031f / fs;
    vsPhase += 0.024f / fs;
    dlyTime += ((0.35f + 0.25f * std::sin(delPhase * kTwoPi)) - dlyTime) * (1.0f / (0.4f * fs));
    fbAmt   += ((0.40f + 0.15f * std::sin(fbPhase * kTwoPi)) - fbAmt)   * (1.0f / (0.4f * fs));
    verbSend+= ((0.65f + 0.35f * std::sin(vsPhase * kTwoPi)) - verbSend)* (1.0f / (0.4f * fs));

    float dS = dlyTime * fs;
    float dL = dlyL.read(dS), dR = dlyR.read(dS);
    float fbL = fbLpF.process(fbHp.process(dL)) * fbAmt;
    // (single filter pair shared across channels keeps CPU low; stereo blur is a feature)
    float fbR = fbL * 0.9f + dR * fbAmt * 0.1f;
    dlyL.write(cL + fbL);
    dlyR.write(cR + fbR);

    float wetL = dL * P.delayMix, wetR = dR * P.delayMix;
    dryL = cL + wetL;
    dryR = cR + wetR;
    sendL = (cL + wetL) * verbSend;
    sendR = (cR + wetR) * verbSend;
  }
};

// ---------------- dust: hiss + crackle printed on the tape ----------------
struct Dust {
  Rng rng{0xD057D057u};
  float lp = 0, prev = 0;
  Biquad bp;
  Biquad crackLp;
  float fs = 48000;
  float crackleEnv = 0;
  float level = 0;

  void init(float sampleRate) {
    fs = sampleRate;
    bp.lowpass(fs, 5000, 0.35f); // bandpass-ish after the differentiator tilt
    crackLp.lowpass(fs, 4500, 0.5f);
  }
  float process(float amount, float activity) {
    // hiss: differentiated lowpassed noise -> high tilt
    float w = rng.bi();
    lp += 0.55f * (w - lp);
    float hiss = bp.process((lp - prev) * 1.4f) * 0.5f;
    prev = lp;
    // crackle: sparse impulses, mostly whisper-small
    if (rng.uni() < 18.0f / fs) {
      float amp = std::pow(rng.uni(), 2.6f) * 0.9f;
      crackleEnv = amp;
    }
    float crack = 0;
    if (crackleEnv > 0.0005f) {
      crack = crackLp.process(rng.bi() * crackleEnv);
      crackleEnv *= 1.0f - 1.0f / (0.004f * fs);
    }
    float target = amount * 0.12f * (0.4f + std::min(activity, 1.2f) * 0.5f);
    level += (target - level) * (1.0f - std::exp(-1.0f / (0.8f * fs)));
    return (hiss + crack) * level;
  }
};

// ---------------- the full Daydream channel ----------------
struct DaydreamEngine {
  DaydreamParams P;
  std::vector<DreamVoice> voices;
  Dust dust;
  FdnReverb verb;
  // tape chain
  Biquad preE, deE, dcb, hp160, warmLs, pres, lpTop;
  float fs = 48000;

  void init(float sampleRate) {
    fs = sampleRate;
    dust.init(fs);
    verb.init(fs, 3.2f, 0.35f);
    preE.shelf(fs, 3200, 4.5f, true);
    deE.shelf(fs, 3200, -4.5f, true);
    dcb.highpass(fs, 20, 0.707f);
    hp160.highpass(fs, 160, 0.5f);
    warmLs.shelf(fs, 300, 1.5f, false);
    pres.peaking(fs, 2000, 1.5f, 0.6f);
    lpTop.lowpass(fs, 10000, 0.3f);
  }

  void addVoice(const std::vector<float>& mono, uint32_t seed) {
    voices.emplace_back();
    voices.back().init(fs, mono, seed);
  }

  // one stereo sample; worldDens/worldWow are the weather modifiers (1 = neutral)
  void process(float& outL, float& outR, float worldDens = 1.0f, float worldWow = 1.0f) {
    float busL = 0, busR = 0, sendL = 0, sendR = 0;
    float activity = 0;
    for (auto& v : voices) {
      float dl, dr, sl, sr;
      v.process(P, worldDens, worldWow, dl, dr, sl, sr);
      busL += dl; busR += dr; sendL += sl; sendR += sr;
      activity += 0.4f;
    }
    // dust rides the same chain as the voices
    float d = dust.process(P.dust, activity);
    busL += d; busR += d;

    // tape chain: pre-emph -> drive -> asym tanh -> dc -> de-emph -> makeup -> EQ
    float makeup = 1.0f / std::pow(P.satDrive, 0.45f);
    auto chain = [&](float x, bool left) {
      (void)left;
      x = preE.process(x); // note: shared filters fold stereo slightly; fine for tape
      x = tapeShape(x * P.satDrive);
      x = dcb.process(x);
      x = deE.process(x);
      x *= makeup;
      x = hp160.process(x);
      x = warmLs.process(x);
      x = pres.process(x);
      x = lpTop.process(x);
      return x;
    };
    float mono = (busL + busR) * 0.5f;
    float shaped = chain(mono, true);
    // keep stereo image from the pre-chain signal, weight in the shaped tone
    float chL2 = shaped + (busL - mono) * 0.6f;
    float chR2 = shaped + (busR - mono) * 0.6f;

    float vL, vR;
    verb.process(sendL, sendR, vL, vR);

    outL = (chL2 * 0.85f + vL * P.verbWet) * P.volume;
    outR = (chR2 * 0.85f + vR * P.verbWet) * P.volume;
  }
};

} // namespace sp
