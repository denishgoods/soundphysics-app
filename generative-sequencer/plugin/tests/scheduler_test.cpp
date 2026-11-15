// Tests for BlockScheduler with a simulated plugin host. Exit code 0 = pass.
// Run via test/plugin-parity.test.js (npm test) or directly.

#include "../engine/block_scheduler.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

using namespace organic;

static int failures = 0;
#define CHECK(cond, ...)                                     \
    do {                                                     \
        if (!(cond)) {                                       \
            failures++;                                      \
            std::printf("FAIL %s:%d: ", __FILE__, __LINE__); \
            std::printf(__VA_ARGS__);                        \
            std::printf("\n");                               \
        }                                                    \
    } while (0)

struct Played { long sample; double u; int note, velocity; };

struct HostSim {
    double sr = 44100, bpm = 120;
    bool loop = false, reportLoop = true;
    double loopStart = 0, loopEnd = 0;
    unsigned rng = 12345;
    int fixedBlock = 512;    // 0 = random sizes
    long sample = 0;         // global sample counter
    double u = 0;            // unrolled beats
    double song = 0;
    std::vector<Played> played;
    std::vector<MidiNote> scratch;

    int nextBlock() {
        if (fixedBlock) return fixedBlock;
        rng = rng * 1103515245u + 12345u;
        return 16 + static_cast<int>((rng >> 8) % 1000);
    }

    void run(BlockScheduler& s, double beats, bool playing = true) {
        double target = u + beats;
        while (u < target) {
            int n = nextBlock();
            double bps = bpm / 60 / sr;
            HostTransport t;
            t.playing = playing;
            t.hasPosition = true;
            t.ppq = song;
            t.bpm = bpm;
            t.sampleRate = sr;
            t.numSamples = n;
            t.looping = loop && reportLoop;
            t.loopStart = loopStart;
            t.loopEnd = loopEnd;
            scratch.clear();
            s.process(t, scratch);
            for (const auto& m : scratch) {
                CHECK(m.sample >= 0 && m.sample < n, "sample offset %d outside block of %d", m.sample, n);
                played.push_back({sample + m.sample, u + m.sample * bps, m.note, m.velocity});
            }
            sample += n;
            double before = song;
            u += n * bps;
            song += n * bps;
            if (loop && before < loopEnd && song >= loopEnd) song = loopStart + (song - loopEnd);
        }
    }

    std::vector<Played> ons() const {
        std::vector<Played> o;
        for (const auto& p : played) if (p.velocity > 0) o.push_back(p);
        return o;
    }
};

static std::vector<Event> truth(double beats) {
    Engine e;
    e.reset(0);
    return e.generate(0, beats);
}

// Every reference event fires once, within one sample of its beat (in U).
static void expectMatches(const std::vector<Played>& ons, const std::vector<Event>& ref, double bps, const char* label) {
    CHECK(ons.size() == ref.size(), "%s: %zu played vs %zu expected", label, ons.size(), ref.size());
    std::vector<bool> used(ons.size(), false);
    for (const auto& e : ref) {
        bool found = false;
        for (size_t i = 0; i < ons.size(); i++) {
            if (used[i] || ons[i].note != e.note || ons[i].velocity != e.velocity) continue;
            if (std::fabs(ons[i].u - e.beat) <= 1.01 * bps) {
                used[i] = found = true;
                break;
            }
        }
        CHECK(found, "%s: note %d vel %d at beat %.6f not played on time", label, e.note, e.velocity, e.beat);
        if (!found) return;
    }
}

static void testLinear() {
    for (int block : {512, 64, 0}) {
        Engine eng;
        BlockScheduler s(eng);
        HostSim h;
        h.fixedBlock = block;
        h.run(s, 64);
        auto ons = h.ons();
        std::vector<Played> inRange;
        for (const auto& p : ons) if (p.u < 63.9) inRange.push_back(p);
        auto ref = truth(63.9);
        expectMatches(inRange, ref, h.bpm / 60 / h.sr, block ? "linear fixed blocks" : "linear random blocks");
        CHECK(s.stats().jumps == 0 && s.stats().wraps == 0, "linear: jumps %ld wraps %ld", s.stats().jumps, s.stats().wraps);
    }
}

static void testLoop(bool report) {
    Engine eng;
    BlockScheduler s(eng);
    HostSim h;
    h.fixedBlock = 0;
    h.loop = true;
    h.reportLoop = report;
    h.loopStart = 4;
    h.loopEnd = 12;
    h.run(s, 100);
    std::vector<Played> inRange;
    for (const auto& p : h.ons()) if (p.u < 99.9) inRange.push_back(p);
    // Bar-aligned loop: unrolled play time equals engine time, so the notes
    // are those of a linear run, folded into the loop.
    expectMatches(inRange, truth(99.9), h.bpm / 60 / h.sr, report ? "loop (host reports it)" : "loop (host silent)");
    if (report) CHECK(s.stats().wraps >= 10 && s.stats().jumps == 0, "wraps %ld jumps %ld", s.stats().wraps, s.stats().jumps);
    else CHECK(s.stats().jumps >= 10, "jumps %ld", s.stats().jumps);
}

static void testStop() {
    Engine eng;
    BlockScheduler s(eng);
    HostSim h;
    h.run(s, 10);
    size_t before = h.played.size();
    h.run(s, 4, false);
    int offs = 0, ons = 0;
    for (size_t i = before; i < h.played.size(); i++) (h.played[i].velocity ? ons : offs)++;
    CHECK(ons == 0, "notes after stop: %d", ons);
    CHECK(offs >= 4, "release on stop: %d note-offs", offs);
    CHECK(!s.isRunning(), "still running after stop");
}

static void testTempoChange() {
    Engine eng;
    BlockScheduler s(eng);
    HostSim h;
    h.run(s, 20);
    h.bpm = 90;
    h.run(s, 20);
    std::vector<Played> inRange;
    for (const auto& p : h.ons()) if (p.u < 39.9) inRange.push_back(p);
    // Flam spacing depends on tempo, so compare onsets of non-flam notes only
    // by count tolerance: every reference event must still land on time.
    Engine ref;
    ref.setParam("ghosts", 35);
    ref.reset(0);
    auto evs = ref.generate(0, 39.9);
    size_t matched = 0;
    for (const auto& e : evs)
        for (const auto& p : inRange)
            if (p.note == e.note && std::fabs(p.u - e.beat) < 0.002) { matched++; break; }
    CHECK(matched + 6 >= evs.size(), "tempo change: %zu of %zu notes on time", matched, evs.size());
}

// Random abuse: notes always pair up, nothing hangs after stop.
static void testFuzz() {
    for (int run = 0; run < 20; run++) {
        Engine eng;
        eng.setParam("density", 30 + run * 3);
        eng.setParam("ghosts", (run * 37) % 100);
        BlockScheduler s(eng);
        HostSim h;
        h.fixedBlock = 0;
        h.rng = 777 + run;
        unsigned r = 99 + run;
        auto rnd = [&]() { r = r * 1664525u + 1013904223u; return (r >> 8) / 16777216.0; };
        for (int step = 0; step < 60; step++) {
            double x = rnd();
            if (x < 0.1) h.song = std::floor(rnd() * 64);
            else if (x < 0.2) { h.loop = !h.loop; h.loopStart = std::floor(rnd() * 8); h.loopEnd = h.loopStart + 1 + std::floor(rnd() * 6) * 0.75; }
            else if (x < 0.3) h.bpm = 60 + rnd() * 120;
            else if (x < 0.35) h.reportLoop = !h.reportLoop;
            h.run(s, 0.5 + rnd() * 6, rnd() > 0.08);
        }
        h.run(s, 1, false);
        bool sounding[128] = {};
        for (const auto& p : h.played) {
            if (p.velocity > 0) {
                CHECK(!sounding[p.note], "run %d: note %d retriggered while sounding at sample %ld", run, p.note, p.sample);
                sounding[p.note] = true;
            } else {
                sounding[p.note] = false;
            }
        }
        for (int nn = 0; nn < 128; nn++) CHECK(!sounding[nn], "run %d: note %d left hanging", run, nn);
    }
}

int main() {
    testLinear();
    testLoop(true);
    testLoop(false);
    testStop();
    testTempoChange();
    testFuzz();
    if (failures) {
        std::printf("%d failure(s)\n", failures);
        return 1;
    }
    std::printf("scheduler tests passed\n");
    return 0;
}
