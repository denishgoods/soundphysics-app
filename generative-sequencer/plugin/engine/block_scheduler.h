// Sample-accurate scheduling for a plugin host. The host calls process()
// once per audio block with its transport; notes come back with sample
// offsets inside the block, so timing is exact (no look-ahead needed, unlike
// the Max device).
//
// Timelines as in engine/scheduler.js: song (host position, jumps back at
// loops), U (unrolled play time, for note-offs) and E (engine time, keeps
// the song's bar phase). A loop wrap inside a block is split at the loop
// end when the host reports loop points; any other jump while playing is
// treated the same way (the performance continues at the new position), so
// loops keep evolving even in hosts that don't report their loop.

#pragma once

#include "organic.h"

#include <vector>

namespace organic {

struct HostTransport {
    bool playing = false;
    bool hasPosition = false;
    double ppq = 0;          // song position at the first sample of the block, quarter notes
    double bpm = 120;
    double sampleRate = 44100;
    int numSamples = 0;
    bool looping = false;    // host loop/cycle active and loop points valid
    double loopStart = 0, loopEnd = 0;
    int tsNum = 4, tsDen = 4;
};

struct MidiNote {
    int sample;    // offset in the block
    int note;
    int velocity;  // 0 = note-off
};

struct SchedulerStats {
    long notes = 0, merged = 0, starts = 0, wraps = 0, jumps = 0;
};

class BlockScheduler {
public:
    explicit BlockScheduler(Engine& e) : engine(e) {}
    // Appends this block's MIDI to `out`, sorted by sample (offs first).
    void process(const HostTransport& t, std::vector<MidiNote>& out);
    // Releases everything now (e.g. when the plugin is bypassed or reset).
    void panic(std::vector<MidiNote>& out);
    bool isRunning() const { return running; }
    double currentBar() const;
    const SchedulerStats& stats() const { return st; }

private:
    struct Segment { double songStart, eStart; };
    struct Pending { int note; double offU; };

    void start(const HostTransport& t);
    void releaseAll(std::vector<MidiNote>& out);
    void runPart(double songFrom, double songTo, double blockSong, double bps, int n, std::vector<MidiNote>& out);
    void schedule(const Event& ev, double songBeat, double blockSong, double bps, int n, std::vector<MidiNote>& out);
    Segment wrapTo(double songTo, double newSong) const;

    Engine& engine;
    bool running = false;
    Segment seg{0, 0};
    double cursorE = 0;      // engine time generated so far
    double uBlock = 0;       // U at the start of the current block
    double songAtBlock = 0;  // song position at the start of the current block
    double expectedSong = 0; // where the next block should start
    std::string meterKey;
    std::vector<Pending> pending;
    double lastOnU[128];
    SchedulerStats st;
};

} // namespace organic
