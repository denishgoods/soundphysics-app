#include "block_scheduler.h"

#include <algorithm>
#include <cmath>

namespace organic {

namespace {
constexpr double kMinGap = 0.02; // beats: same-pitch onsets closer than this are merged
}

double BlockScheduler::currentBar() const {
    return running ? std::floor(songAtBlock / engine.meter().barLen) + 1 : 0;
}

void BlockScheduler::start(const HostTransport& t) {
    engine.setTempo(t.bpm);
    engine.setMeter(t.tsNum, t.tsDen);
    engine.reset(t.ppq);
    meterKey = engine.meter().key;
    seg = {t.ppq, t.ppq};
    cursorE = t.ppq;
    uBlock = t.ppq;
    expectedSong = t.ppq;
    for (double& x : lastOnU) x = -1e18;
    running = true;
    st.starts++;
}

void BlockScheduler::releaseAll(std::vector<MidiNote>& out) {
    bool done[128] = {};
    for (const auto& p : pending) {
        if (!done[p.note]) out.push_back({0, p.note, 0});
        done[p.note] = true;
    }
    for (const auto& l : engine.lanes()) {
        if (!done[l.note]) out.push_back({0, l.note, 0});
        done[l.note] = true;
    }
    pending.clear();
    for (double& x : lastOnU) x = -1e18;
}

void BlockScheduler::panic(std::vector<MidiNote>& out) {
    releaseAll(out);
    running = false;
}

// E position where the song re-enters at `newSong` after leaving at `songTo`:
// keep E advancing, skipping forward by less than a bar to keep the bar phase.
BlockScheduler::Segment BlockScheduler::wrapTo(double songTo, double newSong) const {
    double bar = engine.meter().barLen;
    double eEnd = seg.eStart + (songTo - seg.songStart);
    double d = std::fmod(newSong - eEnd, bar);
    if (d < 0) d += bar;
    if (d < 1e-6 || bar - d < 1e-6) d = 0;
    return {newSong, eEnd + d};
}

void BlockScheduler::process(const HostTransport& t, std::vector<MidiNote>& out) {
    size_t first = out.size();
    int n = t.numSamples;
    if (!t.playing || !t.hasPosition || !(t.bpm > 0) || !(t.sampleRate > 0) || n <= 0) {
        if (running) {
            releaseAll(out);
            running = false;
        }
        return;
    }
    double bps = t.bpm / 60.0 / t.sampleRate; // beats per sample
    double blockBeats = n * bps;

    if (!running || makeMeter(t.tsNum, t.tsDen).key != meterKey) {
        if (running) releaseAll(out);
        start(t);
    } else {
        double tol = std::max(4 * bps, 1e-6);
        if (std::fabs(t.ppq - expectedSong) > tol) {
            // Unplanned jump (a loop the host didn't announce, or a locate):
            // continue the performance from the new position.
            releaseAll(out);
            seg = wrapTo(expectedSong, t.ppq);
            cursorE = seg.eStart;
            st.jumps++;
        }
    }
    engine.setTempo(t.bpm);
    songAtBlock = t.ppq;

    double songFrom = t.ppq;
    double songTo = t.ppq + blockBeats;
    bool loopValid = t.looping && t.loopEnd - t.loopStart >= 1.0 / 16;
    if (loopValid && songFrom < t.loopEnd - 1e-9 && songTo > t.loopEnd) {
        // Wrap inside this block: play up to the loop end, then from the loop start.
        runPart(songFrom, t.loopEnd, t.ppq, bps, n, out);
        double rest = songTo - t.loopEnd;
        seg = wrapTo(t.loopEnd, t.loopStart);
        cursorE = seg.eStart;
        st.wraps++;
        double offsetBeats = t.loopEnd - t.ppq;          // where the loop start lands in the block
        runPart(t.loopStart, t.loopStart + rest, t.loopStart - offsetBeats, bps, n, out);
        expectedSong = t.loopStart + rest;
    } else {
        runPart(songFrom, songTo, t.ppq, bps, n, out);
        expectedSong = songTo;
    }

    // Note-offs due in this block.
    double uEnd = uBlock + blockBeats;
    for (size_t i = 0; i < pending.size();) {
        if (pending[i].offU < uEnd) {
            int s = static_cast<int>(std::floor((pending[i].offU - uBlock) / bps));
            out.push_back({std::min(n - 1, std::max(0, s)), pending[i].note, 0});
            pending[i] = pending.back();
            pending.pop_back();
        } else {
            i++;
        }
    }
    uBlock = uEnd;

    std::stable_sort(out.begin() + static_cast<long>(first), out.end(), [](const MidiNote& a, const MidiNote& b) {
        if (a.sample != b.sample) return a.sample < b.sample;
        return (a.velocity == 0) > (b.velocity == 0);
    });
}

// One stretch of song time inside the block. `blockSong` is the song
// position the block's first sample would have on this stretch's timeline.
void BlockScheduler::runPart(double songFrom, double songTo, double blockSong, double bps, int n, std::vector<MidiNote>& out) {
    double eFrom = seg.eStart + (songFrom - seg.songStart);
    double eTo = seg.eStart + (songTo - seg.songStart);
    if (eFrom > cursorE) cursorE = eFrom;
    if (!(eTo > cursorE)) return;
    std::vector<Event> evs = engine.generate(cursorE, eTo);
    cursorE = eTo;
    for (const auto& ev : evs) schedule(ev, seg.songStart + (ev.beat - seg.eStart), blockSong, bps, n, out);
}

void BlockScheduler::schedule(const Event& ev, double songBeat, double blockSong, double bps, int n, std::vector<MidiNote>& out) {
    double offBeats = std::max(0.0, songBeat - blockSong);
    int s = std::min(n - 1, static_cast<int>(std::floor(offBeats / bps)));
    double uOn = uBlock + s * bps;
    int note = ev.note;
    if (uOn - lastOnU[note] < kMinGap) {
        st.merged++;
        return;
    }
    // A pitch never overlaps itself: release an earlier note that would
    // still be sounding (offs due before this note are emitted in order).
    for (size_t i = 0; i < pending.size(); i++) {
        if (pending[i].note == note && pending[i].offU > uOn) {
            out.push_back({s, note, 0});
            pending[i] = pending.back();
            pending.pop_back();
            break;
        }
    }
    out.push_back({s, note, ev.velocity});
    pending.push_back({note, uBlock + offBeats + ev.duration});
    lastOnU[note] = uOn;
    st.notes++;
}

} // namespace organic
