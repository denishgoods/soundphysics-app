// C++ port of the Organic engine (engine/*.js). No JUCE, no allocation-free
// guarantees: call it from the audio thread only through BlockScheduler,
// which does bounded work per block.
//
// The port mirrors the JavaScript statement by statement, including the
// order of every random draw, so both produce the same performance for the
// same seed and settings. test/plugin-parity.test.js checks that.
// Build with -ffp-contract=off (no fused multiply-add) to keep float results
// identical to JavaScript.

#pragma once

#include <cstdint>
#include <deque>
#include <map>
#include <memory>
#include <string>
#include <vector>

namespace organic {

constexpr const char* kVersion = "0.4.0";

// ---- prng -------------------------------------------------------------
uint32_t hash32(std::initializer_list<int32_t> args);
inline int32_t toInt32(double x) { return static_cast<int32_t>(static_cast<int64_t>(x)); }
inline int32_t u2i(uint32_t x) { return static_cast<int32_t>(x); }

class Rng {
public:
    explicit Rng(uint32_t seed) : s(seed) {}
    double next();
    double range(double a, double b) { return a + (b - a) * next(); }
    int32_t intBelow(double n);
    bool chance(double p) { return next() < p; }
    double gauss();
    int weighted(const std::vector<double>& w);
private:
    uint32_t s;
};

// ---- noise ------------------------------------------------------------
class Noise {
public:
    Noise() = default;
    Noise(uint32_t seed, int octaves, double persistence);
    double operator()(double x) const;
private:
    int octaves = 0;
    std::vector<uint32_t> seeds;
    std::vector<double> offsets, amps;
    double norm = 1;
};

// ---- meter ------------------------------------------------------------
enum class Family { Main, Cross, Odd, Free };

struct Level { double period, weight; Family family; };
struct Attractor { double pos, weight; Family family; int level; };

struct Meter {
    int num = 4, den = 4;
    double beatLen = 1, barLen = 4, pulse = 1, pulsesPerBar = 4, strong = 2;
    bool compound = false;
    std::vector<Level> levels;
    std::vector<Attractor> attractors;
    std::string key;
};

Meter makeMeter(int num, int den);
double distToMultiple(double x, double period);
bool isOn(double x, double period);
double metricWeight(const Meter& m, double pos);
double swingWarp(const Meter& m, double pos, double amount);

// ---- breath -----------------------------------------------------------
enum class Shape { Build, Arch, Steady, Fade };

struct PhraseInfo {
    int index, bars, barInPhrase;
    bool isFirst, isLast;
    Shape shape;
    double restInBar;
};

class BreathEnvelope {
public:
    explicit BreathEnvelope(uint32_t seed);
    double value(double barPos);
    double densityAt(double barPos);
    PhraseInfo info(int bar);
private:
    struct Phrase { int index, start, bars; Shape shape; double level, rest; };
    void extend(int bar);
    const Phrase& phraseAt(double bar);
    uint32_t seed;
    std::vector<Phrase> phrases;
    Noise wobble;
};

// ---- lanes and roles --------------------------------------------------
enum class Role { Anchor, Backbeat, Pulse, Color };

struct RoleProfile {
    int maxNotes;
    double minSpacing, sharp, prioCurve, velocity, ghostVel;
    int ghostMax;
    double accentP, flam, bias, duration, breathSens;
};
const RoleProfile& profile(Role r);

struct Lane { std::string name; int note; Role role; double density; };
std::vector<Lane> defaultLanes();

// ---- params -----------------------------------------------------------
// isInt covers enums too; `options` is "A|B|..." for enums, else nullptr.
struct ParamSpec { const char* id; const char* name; bool isInt; double min, max, def; const char* unit; const char* options; };
constexpr int kNumParams = 10;
constexpr int kModeParam = 9;
enum class Mode { Organic = 0, Irregular = 1, Mathematical = 2, Physical = 3 };
extern const ParamSpec kParams[kNumParams];
int paramIndex(const std::string& id);

struct Normalized {
    double density, looseness, drift, swing, breath, memory, accent, ghosts;
    uint32_t seed;
    int mode;
};

// ---- notes, plans, events ---------------------------------------------
enum class Kind { Main = 0, Fill = 1, Ghost = 2 };

struct Note {
    int32_t id = 0;
    int lane = 0;
    double pos = 0, att = 0;
    Family fam = Family::Main;
    Kind kind = Kind::Main;
    double prio = 0.5, accent = 0;
    bool flam = false;
    double fillProg = 0;
    double w = -1;    // emphasis 0..1; < 0 = use the metric weight of pos
    double vel = -1;  // own loudness 0..1 (physical mode); < 0 = unset
    int uid = 0;
};

struct Event { double beat; int lane; int note; int velocity; double duration; };

struct Ctx { const Meter* meter; const std::vector<Lane>* lanes; const Normalized* p; };

class MotifMemory {
public:
    std::vector<Note> next(int bar, const PhraseInfo& info, Rng& rng, const Ctx& ctx);
private:
    struct Motif { std::vector<Note> notes; double strength; int born; int uses; };
    Motif* store(std::vector<Note> notes, int bar);
    std::vector<std::unique_ptr<Motif>> bank;
    Motif* current = nullptr;
};

// ---- engine -----------------------------------------------------------
class Engine {
public:
    Engine();
    void reset(double startBeat);
    // Every event with start <= beat < end, sorted, exactly once across
    // consecutive windows (same contract as the JS timeline).
    std::vector<Event> generate(double start, double end);

    bool setParam(int index, double value);   // display units; clamped
    bool setParam(const std::string& id, double value);
    double getParam(int index) const { return values[index]; }
    void setTempo(double bpm);
    void setMeter(int num, int den);          // applied at the next reset
    const std::vector<Lane>& lanes() const { return laneList; }
    const Meter& meter() const { return meterNow; }
    Mode mode() const { return static_cast<Mode>(p.mode); }

private:
    struct Plan { int k; std::vector<Note> notes; PhraseInfo info; };
    struct Cached { Event ev; uint64_t seq; bool done, dropped, returned; };

    // modulators
    void buildModulators();
    const Noise& noise(const char* name, int index, int octaves, double persistence);

    // organic generator
    void genInit();
    std::vector<Event> genGenerate(double start, double end);
    const Plan& getPlan(int k);
    Plan makePlan(int k);
    std::vector<Note> organicPlan(int k, const PhraseInfo& info, Rng& rng);
    std::vector<Note> addFill(std::vector<Note> notes, const PhraseInfo& info, Rng& rng);
    // irregular mode (generators/irregular/index.js)
    struct Figure { std::vector<int> groups; int id; };
    std::vector<Note> irregularPlan(int k, const PhraseInfo& info, Rng& rng);
    std::vector<Note> figureNotes(const Figure& fig, int phase);
    std::vector<Note> irregularFill(std::vector<Note> notes, const PhraseInfo& info, Rng& rng, const Figure& fig, int phase);
    void storeFigure(std::vector<int> groups);
public:  // config types used by free helpers in organic.cpp
    struct LaneCycle { int n, r, kAdj; };
    struct Drop { double at, p, interval, e, u; };
    struct PhysLane { double detune; std::vector<Drop> drops; };
private:
    // mathematical mode (generators/mathematical/index.js)
    struct MathFig { std::vector<LaneCycle> cfg; int id; };
    std::vector<Note> mathematicalPlan(int k, const PhraseInfo& info, Rng& rng);
    std::vector<LaneCycle> mathNewConfig(Rng& rng, int U);
    std::vector<Note> mathBarNotes(const MathFig& fig, int k);
    std::vector<Note> mathFill(std::vector<Note> notes, const PhraseInfo& info, Rng& rng);
    void storeMath(std::vector<LaneCycle> cfg);
    // physical mode (generators/physical/index.js)
    struct PhysFig { std::vector<PhysLane> cfg; int id; };
    struct Ball { int lane; double t, interval, e, vel; int j; };
    std::vector<Note> physicalPlan(int k, const PhraseInfo& info, Rng& rng);
    std::vector<PhysLane> physNewConfig(Rng& rng);
    void storePhys(std::vector<PhysLane> cfg);
    void render(const Note& c, int k, double barStart, std::vector<Event>& out);

    // timeline
    void jump(double start);
    void renderUntil(double need);
    void insert(std::vector<Cached>& fresh);
    void finalize(size_t i);
    size_t lowerBound(double beat) const;
    void trim(double before);

    double values[kNumParams];
    Normalized p{};
    uint32_t seed = 1;
    std::vector<Lane> laneList;
    Meter meterNow;
    bool meterPending = false;
    Meter pendingMeter;
    double bpm = 120;
    double origin = 0;

    std::unique_ptr<BreathEnvelope> breath;
    std::map<std::string, Noise> noises;

    MotifMemory memory;
    std::deque<std::shared_ptr<Figure>> figBank;
    std::shared_ptr<Figure> figCurrent;
    int figPhase = 0;
    int figNextId = 1;
    std::deque<std::shared_ptr<MathFig>> mathBank;
    std::shared_ptr<MathFig> mathCurrent;
    int mathNextId = 1;
    std::deque<std::shared_ptr<PhysFig>> physBank;
    std::shared_ptr<PhysFig> physCurrent;
    int physNextId = 1;
    int physNextNote = 1;
    std::vector<double> physPend;
    std::vector<Ball> physBalls;
    std::map<int, Plan> plans;
    int nextBar = 0;

    std::vector<Cached> cache;
    double renderedTo = 0, floorBeat = 0, lastEnd = 0;
    uint64_t seqCounter = 0;
};

} // namespace organic

namespace organic {
// Exposed for tests (irregular mode groupings).
std::vector<int> newGrouping(Rng& rng, int U, double looseness);
std::vector<int> varyGrouping(const std::vector<int>& groups, Rng& rng);
}
