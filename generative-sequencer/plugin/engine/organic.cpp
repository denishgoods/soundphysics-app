// C++ port of engine/*.js. Each section names the JS file it mirrors; keep
// them in step (test/plugin-parity.test.js compares the two).

#include "organic.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace organic {

namespace {
constexpr double kEps = 1e-9;
constexpr double kPi = 3.141592653589793;

// JavaScript Math.round: halves round towards +infinity.
inline double jsRound(double x) {
    double r = std::floor(x);
    if (x - r >= 0.5) r += 1.0;
    return r;
}
inline double clampd(double x, double a, double b) { return x < a ? a : (x > b ? b : x); }

inline uint32_t fmix32(uint32_t h) {
    h ^= h >> 16;
    h *= 0x85ebca6bu;
    h ^= h >> 13;
    h *= 0xc2b2ae35u;
    h ^= h >> 16;
    return h;
}
inline uint32_t rotl(uint32_t x, int r) { return (x << r) | (x >> (32 - r)); }
} // namespace

// ---- prng.js ------------------------------------------------------------

uint32_t hash32(std::initializer_list<int32_t> args) {
    uint32_t h = 0x9747b28cu ^ static_cast<uint32_t>(args.size());
    for (int32_t a : args) {
        uint32_t k = static_cast<uint32_t>(a);
        k *= 0xcc9e2d51u;
        k = rotl(k, 15);
        k *= 0x1b873593u;
        h ^= k;
        h = rotl(h, 13);
        h = h * 5u + 0xe6546b64u;
    }
    return fmix32(h);
}

double Rng::next() {
    s += 0x6d2b79f5u;
    uint32_t t = (s ^ (s >> 15)) * (1u | s);
    t = (t + ((t ^ (t >> 7)) * (61u | t))) ^ t;
    return static_cast<double>(t ^ (t >> 14)) / 4294967296.0;
}

int32_t Rng::intBelow(double n) { return toInt32(std::floor(next() * n)); }

double Rng::gauss() {
    double a = next();
    a += next();
    a += next();
    a += next();
    return (a - 2) * 1.7320508075688772;
}

int Rng::weighted(const std::vector<double>& w) {
    double total = 0;
    for (double x : w) total += std::max(0.0, x);
    if (total <= 0) return intBelow(static_cast<double>(w.size()));
    double r = next() * total;
    for (size_t i = 0; i < w.size(); i++) {
        r -= std::max(0.0, w[i]);
        if (r < 0) return static_cast<int>(i);
    }
    return static_cast<int>(w.size()) - 1;
}

// ---- modulators/noise.js --------------------------------------------------

namespace {
inline double lattice(uint32_t seed, int32_t i) {
    return static_cast<double>(hash32({u2i(seed), i})) / 2147483648.0 - 1;
}
double bspline(uint32_t seed, double x) {
    double fi = std::floor(x);
    int32_t i = toInt32(fi);
    double t = x - fi;
    double t2 = t * t;
    double t3 = t2 * t;
    double w0 = (1 - 3 * t + 3 * t2 - t3) / 6;
    double w1 = (3 * t3 - 6 * t2 + 4) / 6;
    double w2 = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6;
    double w3 = t3 / 6;
    return w0 * lattice(seed, i - 1) + w1 * lattice(seed, i) + w2 * lattice(seed, i + 1) + w3 * lattice(seed, i + 2);
}
} // namespace

Noise::Noise(uint32_t seed, int oct, double persistence) : octaves(oct) {
    double sumSq = 0;
    for (int k = 0; k < octaves; k++) {
        seeds.push_back(hash32({u2i(seed), 0x5eed, k}));
        offsets.push_back((static_cast<double>(hash32({u2i(seed), 0x0ff5, k})) / 4294967296.0) * 1024);
        double a = std::pow(persistence, k);
        amps.push_back(a);
        sumSq += a * a;
    }
    norm = 1 / (std::sqrt(sumSq) * 0.4);
}

double Noise::operator()(double x) const {
    double sum = 0;
    double f = 1;
    for (int k = 0; k < octaves; k++) {
        sum += amps[k] * bspline(seeds[k], x * f + offsets[k]);
        f *= 2;
    }
    return std::tanh(sum * norm * 0.5);
}

// ---- meter.js -------------------------------------------------------------

Meter makeMeter(int numIn, int denIn) {
    Meter m;
    int num = std::max(1, numIn > 0 ? numIn : 4);
    int den = (denIn == 1 || denIn == 2 || denIn == 4 || denIn == 8 || denIn == 16) ? denIn : 4;
    m.num = num;
    m.den = den;
    m.beatLen = 4.0 / den;
    m.barLen = num * m.beatLen;
    m.compound = den >= 8 && num % 3 == 0 && num > 3;
    m.pulse = m.compound ? 3 * m.beatLen : m.beatLen;
    m.pulsesPerBar = m.barLen / m.pulse;
    bool evenPulses = std::fabs(m.pulsesPerBar - jsRound(m.pulsesPerBar)) < kEps && static_cast<long>(jsRound(m.pulsesPerBar)) % 2 == 0;
    auto lv = [&](double period, double weight, Family f) { m.levels.push_back({period, weight, f}); };
    lv(m.barLen, 1.0, Family::Main);
    bool halfBar = evenPulses && m.pulsesPerBar >= 4;
    if (halfBar) lv(m.barLen / 2, 0.82, Family::Main);
    m.strong = halfBar ? m.barLen / 2 : m.barLen;
    lv(m.pulse, 0.66, Family::Main);
    if (m.compound) {
        lv(m.pulse / 3, 0.46, Family::Main);
        lv(m.pulse / 6, 0.3, Family::Main);
        lv(m.pulse / 2, 0.3, Family::Cross);
        lv(m.pulse / 4, 0.18, Family::Cross);
    } else {
        lv(m.pulse / 2, 0.46, Family::Main);
        lv(m.pulse / 4, 0.3, Family::Main);
        lv(m.pulse / 3, 0.34, Family::Cross);
        lv(m.pulse / 6, 0.2, Family::Cross);
    }
    lv(m.pulse / 5, 0.16, Family::Odd);
    m.key = std::to_string(num) + "/" + std::to_string(den);

    for (size_t i = 0; i < m.levels.size(); i++) {
        const Level& L = m.levels[i];
        long n = static_cast<long>(jsRound(m.barLen / L.period));
        for (long j = 0; j < n; j++) {
            double pos = j * L.period;
            if (pos > m.barLen - kEps) break;
            bool exists = false;
            for (const auto& a : m.attractors)
                if (std::fabs(a.pos - pos) < 1e-6) { exists = true; break; }
            if (exists) continue;
            m.attractors.push_back({pos, L.weight, L.family, static_cast<int>(i)});
        }
    }
    std::stable_sort(m.attractors.begin(), m.attractors.end(), [](const Attractor& a, const Attractor& b) { return a.pos < b.pos; });
    return m;
}

double distToMultiple(double x, double period) { return std::fabs(x - jsRound(x / period) * period); }
bool isOn(double x, double period) { return distToMultiple(x, period) < 1e-6; }

double metricWeight(const Meter& m, double pos) {
    double best = 0.1;
    for (const auto& L : m.levels) {
        double d = distToMultiple(pos, L.period) / 0.04;
        double w = L.weight * std::exp(-d * d);
        if (w > best) best = w;
    }
    return best;
}

namespace {
double warpSpan(double x, double span, double mm) {
    double k = std::floor(x / span + kEps);
    double f = x / span - k;
    double g = f < 0.5 ? f * (mm / 0.5) : mm + (f - 0.5) * ((1 - mm) / 0.5);
    return (k + g) * span;
}
} // namespace

double swingWarp(const Meter& m, double pos, double amount) {
    if (m.compound || !(amount > 0)) return pos;
    double a = std::min(1.0, amount);
    double m16 = 0.5 + 0.12 * a;
    double m8 = 0.5 + 0.17 * a;
    return warpSpan(warpSpan(pos, m.pulse / 2, m16), m.pulse, m8);
}

// ---- modulators/breath.js -----------------------------------------------

namespace {
constexpr double kRestLevel = 0.04;
constexpr double kRestFade = 0.125;
double shapeValue(Shape s, double u) {
    switch (s) {
        case Shape::Build: return 0.3 + 1.0 * std::pow(u, 1.5);
        case Shape::Arch: return 0.4 + 0.85 * std::sin(kPi * u);
        case Shape::Fade: return 1.25 - 0.85 * u;
        default: return 0.95 + 0.12 * std::sin(2 * kPi * u);
    }
}
} // namespace

BreathEnvelope::BreathEnvelope(uint32_t s) : seed(s), wobble(hash32({u2i(s), 0xb4ea7}), 3, 0.5) {}

void BreathEnvelope::extend(int bar) {
    static const int kBars[] = {2, 4, 8};
    static const Shape kShapes[] = {Shape::Build, Shape::Arch, Shape::Steady, Shape::Fade};
    static const double kRest[] = {0.25, 0.5, 1};
    for (;;) {
        int start = phrases.empty() ? 0 : phrases.back().start + phrases.back().bars;
        if (!phrases.empty() && start > bar) return;
        int index = static_cast<int>(phrases.size());
        Rng rng(hash32({u2i(seed), 0x9e7a5e, index}));
        int bars = kBars[rng.weighted({1, 3, 2})];
        Shape shape = kShapes[rng.weighted({3, 2, 1.5, 1.5})];
        double level = rng.range(0.85, 1.12);
        double rest = 0;
        if (rng.chance(bars > 2 ? 0.6 : 0.3)) rest = kRest[rng.intBelow(bars > 2 ? 3 : 2)];
        phrases.push_back({index, start, bars, shape, level, rest});
    }
}

const BreathEnvelope::Phrase& BreathEnvelope::phraseAt(double bar) {
    int b = static_cast<int>(std::max(0.0, std::floor(bar)));
    extend(b);
    size_t lo = 0, hi = phrases.size() - 1;
    while (lo < hi) {
        size_t mid = (lo + hi + 1) >> 1;
        if (phrases[mid].start <= b) lo = mid;
        else hi = mid - 1;
    }
    return phrases[lo];
}

double BreathEnvelope::value(double barPos) {
    double x = std::max(0.0, barPos);
    const Phrase ph = phraseAt(x);
    double local = x - ph.start;
    double active = ph.bars - ph.rest;
    double wob = 0.08 * wobble(x * 0.7);
    if (local >= active) return kRestLevel;
    double v = ph.level * shapeValue(ph.shape, local / active) + wob;
    if (ph.rest > 0 && local > active - kRestFade) {
        double f = (active - local) / kRestFade;
        double s = 0.5 - 0.5 * std::cos(kPi * f);
        return kRestLevel + (v - kRestLevel) * s;
    }
    return std::max(kRestLevel, v);
}

double BreathEnvelope::densityAt(double barPos) {
    double x = std::max(0.0, barPos);
    const Phrase ph = phraseAt(x);
    double local = x - ph.start;
    double active = ph.bars - ph.rest;
    if (local >= active) return kRestLevel;
    double mid = std::min(active, std::floor(local) + 0.5);
    return std::max(kRestLevel, ph.level * shapeValue(ph.shape, mid / active));
}

PhraseInfo BreathEnvelope::info(int bar) {
    const Phrase ph = phraseAt(bar);
    int barInPhrase = bar - ph.start;
    bool isLast = barInPhrase == ph.bars - 1;
    return {ph.index, ph.bars, barInPhrase, barInPhrase == 0, isLast, ph.shape, isLast ? std::min(1.0, ph.rest) : 0.0};
}

// ---- lanes.js -------------------------------------------------------------

const RoleProfile& profile(Role r) {
    //                         maxN spacing sharp curve  vel  ghostV gMax accP  flam  bias   dur   breath
    static const RoleProfile anchor{6, 0.24, 2.5, 1.4, 104, 50, 2, 0.3, 0, -0.02, 0.25, 0.9};
    static const RoleProfile backbeat{4, 0.2, 3, 1.8, 98, 30, 7, 0.4, 0.4, 0.025, 0.2, 1.0};
    static const RoleProfile pulse{16, 0.2, 3.5, 1, 80, 38, 4, 0.22, 0, 0.008, 0.12, 0.7};
    static const RoleProfile color{4, 0.24, 2, 1, 88, 42, 3, 0.35, 0.25, -0.015, 0.2, 1.2};
    switch (r) {
        case Role::Anchor: return anchor;
        case Role::Backbeat: return backbeat;
        case Role::Pulse: return pulse;
        default: return color;
    }
}

std::vector<Lane> defaultLanes() {
    return {{"Kick", 36, Role::Anchor, 1}, {"Snare", 38, Role::Backbeat, 1}, {"Hat", 42, Role::Pulse, 1}, {"Perc", 37, Role::Color, 1}};
}

namespace {
struct Slot { double pos, weight; };

double familyFactor(Family f, double L, double cross, double odd) {
    if (f == Family::Cross) return cross * (0.05 + 1.1 * L * L);
    if (f == Family::Odd) return odd * 1.2 * L * L * L;
    return 1;
}

double nearestOddPulseDist(const Meter& m, double pos) {
    double best = std::numeric_limits<double>::infinity();
    long n = static_cast<long>(jsRound(m.pulsesPerBar));
    for (long i = 1; i < n; i += 2) best = std::min(best, std::fabs(pos - i * m.pulse));
    return best;
}

double rolePref(Role r, const Attractor& a, const Meter& m, double L) {
    switch (r) {
        case Role::Anchor: {
            if (a.family != Family::Main) return 0.05 * familyFactor(a.family, L, 1, 1);
            double s = std::pow(a.weight, 2.2);
            if (isOn(a.pos + m.pulse / 2, m.strong) && !isOn(a.pos, m.pulse)) s += 0.28;
            else if (isOn(a.pos + m.pulse / 4, m.strong) && !isOn(a.pos, m.pulse / 2)) s += 0.2;
            return s;
        }
        case Role::Backbeat: {
            if (a.family != Family::Main) return 0.06 * familyFactor(a.family, L, 1, 1);
            if (isOn(a.pos, m.pulse)) {
                long idx = static_cast<long>(jsRound(a.pos / m.pulse));
                bool even = static_cast<long>(jsRound(m.pulsesPerBar)) % 2 == 0;
                if (even) return idx % 2 == 1 ? 1 : 0.05;
                return idx >= 1 ? 0.75 : 0.03;
            }
            return 0.05 + 0.08 * (1 - a.weight);
        }
        case Role::Pulse: {
            if (a.family != Family::Main) return 0.12 * familyFactor(a.family, L, 1, 0.25);
            if (isOn(a.pos, m.pulse)) return 1;
            if (isOn(a.pos, m.compound ? m.pulse / 3 : m.pulse / 2)) return 0.85;
            return 0.5;
        }
        default: {
            if (a.family != Family::Main) return 0.4 * familyFactor(a.family, L, 1, 0.4);
            if (a.weight >= 0.8) return 0.02;
            double s = 0.15 + 0.75 * std::pow(1 - a.weight, 1.3);
            if (isOn(a.pos, m.pulse / 2) && !isOn(a.pos, m.pulse)) s += 0.2;
            return s;
        }
    }
}

std::vector<Slot> ghostSlots(Role r, const Meter& m, const std::vector<Note>& mains) {
    std::vector<Slot> out;
    switch (r) {
        case Role::Anchor:
            for (const auto& n : mains) if (n.prio < 0.5) out.push_back({n.pos - m.pulse / 4, 1});
            break;
        case Role::Backbeat:
            for (const auto& a : m.attractors) {
                if (a.family != Family::Main || isOn(a.pos, m.pulse)) continue;
                double d = nearestOddPulseDist(m, a.pos) / 0.4;
                out.push_back({a.pos, (1 - a.weight) * 0.5 + 0.8 * std::exp(-d * d)});
            }
            break;
        case Role::Pulse:
            for (const auto& n : mains) if (n.prio < 0.6) out.push_back({n.pos - m.pulse / 8, 1});
            break;
        default:
            for (const auto& a : m.attractors)
                if (a.family == Family::Main && a.weight < 0.4) out.push_back({a.pos, 1 - metricWeight(m, a.pos)});
            break;
    }
    return out;
}

double accentWeight(Role r, const Attractor& a, const Meter& m) {
    switch (r) {
        case Role::Anchor: return a.weight >= 0.8 ? 1.2 : 0.5;
        case Role::Backbeat: return isOn(a.pos, m.pulse) ? 1 : 0.3;
        case Role::Pulse: return (isOn(a.pos, m.pulse / 2) && !isOn(a.pos, m.pulse)) ? 1 : 0.3;
        default: return a.weight < 0.5 ? 1 : 0.4;
    }
}

// ---- generators/organic/motifs.js ----------------------------------------

constexpr size_t kBankSize = 4;

inline double clampPos(double pos, double barLen) { return std::min(barLen - 1e-6, std::max(0.0, pos)); }

template <typename T, typename W>
std::vector<T> sample(Rng& rng, const std::vector<T>& items, W weightOf, size_t count, double spacing, std::vector<double> occupied) {
    struct Keyed { size_t i; double key; };
    std::vector<Keyed> keyed;
    for (size_t i = 0; i < items.size(); i++) {
        double u = rng.next();
        double w = weightOf(items[i]);
        if (w > 0) keyed.push_back({i, std::log(1 - u) / w});
    }
    std::stable_sort(keyed.begin(), keyed.end(), [](const Keyed& a, const Keyed& b) {
        if (b.key != a.key) return a.key > b.key;
        return a.i < b.i;
    });
    std::vector<T> picked;
    for (size_t j = 0; j < keyed.size() && picked.size() < count; j++) {
        double pos = items[keyed[j].i].pos;
        bool free = true;
        for (double o : occupied)
            if (std::fabs(o - pos) < spacing) { free = false; break; }
        if (!free) continue;
        picked.push_back(items[keyed[j].i]);
        occupied.push_back(pos);
    }
    return picked;
}

inline double laneScale(const Meter& m) { return m.barLen / 4; }

double prioFor(int rank, int n, Rng& rng, double curve) {
    double p = std::pow((rank + 0.5 + rng.range(-0.15, 0.15)) / n, curve);
    return std::min(0.999, std::max(0.001, p));
}

template <typename T, typename S>
std::vector<T> byImportance(const std::vector<T>& items, S scoreOf, Rng& rng) {
    struct K { size_t i; double k; };
    std::vector<K> ks;
    for (size_t i = 0; i < items.size(); i++) ks.push_back({i, scoreOf(items[i]) * rng.range(0.85, 1.15)});
    std::stable_sort(ks.begin(), ks.end(), [](const K& a, const K& b) {
        if (b.k != a.k) return a.k > b.k;
        return a.i < b.i;
    });
    std::vector<T> out;
    for (const auto& k : ks) out.push_back(items[k.i]);
    return out;
}

Note makeMain(int li, const Attractor& att, int rank, int n, Rng& rng, const Ctx& ctx) {
    Role role = (*ctx.lanes)[li].role;
    const RoleProfile& rp = profile(role);
    double disp = rng.gauss() * ctx.p->looseness * 0.02 * (att.family == Family::Main ? 1 : 0.6);
    double accent = rng.chance(rp.accentP * accentWeight(role, att, *ctx.meter)) ? rng.range(0.5, 1) : 0;
    bool flam = accent > 0 && rp.flam > 0 && rng.chance(rp.flam);
    Note note;
    note.id = rng.intBelow(2147483647.0);
    note.lane = li;
    note.pos = clampPos(att.pos + disp, ctx.meter->barLen);
    note.att = att.pos;
    note.fam = att.family;
    note.kind = Kind::Main;
    note.prio = prioFor(rank, n, rng, rp.prioCurve);
    note.accent = accent;
    note.flam = flam;
    return note;
}

std::vector<Note> dedupe(const std::vector<Note>& notes, const Ctx& ctx) {
    std::vector<Note> out;
    for (int li = 0; li < static_cast<int>(ctx.lanes->size()); li++) {
        const RoleProfile& rp = profile((*ctx.lanes)[li].role);
        std::vector<Note> mains, ghosts;
        for (const auto& n : notes) {
            if (n.lane != li) continue;
            (n.kind == Kind::Ghost ? ghosts : mains).push_back(n);
        }
        auto byPrio = [](const Note& a, const Note& b) { return a.prio != b.prio ? a.prio < b.prio : a.pos < b.pos; };
        std::stable_sort(mains.begin(), mains.end(), byPrio);
        std::stable_sort(ghosts.begin(), ghosts.end(), byPrio);
        std::vector<Note> ordered = mains;
        ordered.insert(ordered.end(), ghosts.begin(), ghosts.end());
        std::vector<Note> kept;
        for (const auto& n : ordered) {
            double gap = n.kind == Kind::Ghost ? 0.1 : rp.minSpacing * 0.8;
            bool ok = true;
            for (const auto& k : kept)
                if (!(std::fabs(k.pos - n.pos) >= gap)) { ok = false; break; }
            if (ok) kept.push_back(n);
        }
        out.insert(out.end(), kept.begin(), kept.end());
    }
    return out;
}

std::vector<Note> freshLane(int li, Rng& rng, const Ctx& ctx) {
    const Meter& m = *ctx.meter;
    Role role = (*ctx.lanes)[li].role;
    const RoleProfile& rp = profile(role);
    double L = ctx.p->looseness;
    int n = std::max(1, static_cast<int>(jsRound(rp.maxNotes * laneScale(m))));
    auto weight = [&](const Attractor& a) { return std::pow(rolePref(role, a, m, L), rp.sharp); };
    auto atts = sample(rng, m.attractors, weight, static_cast<size_t>(n), rp.minSpacing, {});
    auto ranked = byImportance(atts, [&](const Attractor& a) { return rolePref(role, a, m, L); }, rng);
    std::vector<Note> mains;
    for (size_t r = 0; r < ranked.size(); r++) mains.push_back(makeMain(li, ranked[r], static_cast<int>(r), n, rng, ctx));

    std::vector<Note> out = mains;
    int nGhost = static_cast<int>(jsRound(rp.ghostMax * laneScale(m)));
    if (nGhost > 0) {
        std::vector<Slot> slots;
        for (const auto& s : ghostSlots(role, m, mains))
            if (s.pos >= 0 && s.pos < m.barLen) slots.push_back(s);
        std::vector<double> taken;
        for (const auto& mn : mains) taken.push_back(mn.pos);
        auto picked = sample(rng, slots, [](const Slot& s) { return std::pow(s.weight, 1.5); }, static_cast<size_t>(nGhost), 0.11, taken);
        auto ordered = byImportance(picked, [](const Slot& s) { return s.weight; }, rng);
        for (size_t r = 0; r < ordered.size(); r++) {
            Note g;
            g.id = rng.intBelow(2147483647.0);
            g.lane = li;
            g.pos = ordered[r].pos;
            g.att = ordered[r].pos;
            g.fam = Family::Main;
            g.kind = Kind::Ghost;
            g.prio = prioFor(static_cast<int>(r), nGhost, rng, 1);
            out.push_back(g);
        }
    }
    return out;
}

std::vector<Note> freshMotif(Rng& rng, const Ctx& ctx) {
    std::vector<Note> notes;
    for (int li = 0; li < static_cast<int>(ctx.lanes->size()); li++) {
        auto lane = freshLane(li, rng, ctx);
        notes.insert(notes.end(), lane.begin(), lane.end());
    }
    return dedupe(notes, ctx);
}

std::vector<Note> varyMotif(const std::vector<Note>& notes, double amount, Rng& rng, const Ctx& ctx) {
    const Meter& m = *ctx.meter;
    double L = ctx.p->looseness;
    std::vector<Note> out;
    for (const auto& n : notes) {
        if (n.kind == Kind::Fill) continue;
        if (n.kind == Kind::Main && n.prio > 0.3 && rng.chance(0.22 * amount)) continue;
        if (n.kind == Kind::Ghost && rng.chance(0.3 * amount)) continue;
        Role role = (*ctx.lanes)[n.lane].role;
        const RoleProfile& rp = profile(role);
        Note c = n;
        c.pos = clampPos(c.pos + rng.gauss() * amount * 0.03 * L, m.barLen);
        if (c.kind == Kind::Main && rng.chance(0.12 * amount)) {
            c.accent = c.accent > 0 ? 0 : rng.range(0.5, 1);
            c.flam = c.accent > 0 && rp.flam > 0 && rng.chance(rp.flam);
        }
        if (c.kind == Kind::Main && rng.chance(0.1 * amount)) {
            std::vector<Attractor> nearAtts;
            for (const auto& a : m.attractors)
                if (std::fabs(a.pos - c.att) > 1e-6 && std::fabs(a.pos - c.att) <= 0.5) nearAtts.push_back(a);
            if (!nearAtts.empty()) {
                std::vector<double> w;
                for (const auto& a : nearAtts) w.push_back(std::pow(rolePref(role, a, m, L), rp.sharp));
                const Attractor& a = nearAtts[rng.weighted(w)];
                c.pos = clampPos(a.pos + (c.pos - c.att), m.barLen);
                c.att = a.pos;
                c.fam = a.family;
            }
        }
        if (rng.chance(0.15 * amount)) c.prio = std::min(0.999, std::max(0.001, c.prio + rng.gauss() * 0.12));
        out.push_back(c);
    }
    int adds = static_cast<int>(std::floor(amount * 1.5 + rng.next() * 0.8));
    for (int i = 0; i < adds; i++) {
        std::vector<double> w;
        for (const auto& l : *ctx.lanes) w.push_back(profile(l.role).maxNotes);
        int li = rng.weighted(w);
        Role role = (*ctx.lanes)[li].role;
        const RoleProfile& rp = profile(role);
        std::vector<double> taken;
        for (const auto& o : out) if (o.lane == li) taken.push_back(o.pos);
        auto weight = [&](const Attractor& a) { return std::pow(rolePref(role, a, m, L), rp.sharp); };
        auto pick = sample(rng, m.attractors, weight, 1, rp.minSpacing, taken);
        if (pick.empty()) continue;
        Note note = makeMain(li, pick[0], 0, 1, rng, ctx);
        note.prio = rng.range(0.35, 0.95);
        out.push_back(note);
    }
    return dedupe(out, ctx);
}
} // namespace

std::vector<Note> MotifMemory::next(int bar, const PhraseInfo& info, Rng& rng, const Ctx& ctx) {
    double m = ctx.p->memory;
    double loose = 1 - m;
    for (auto& mo : bank) mo->strength *= 0.97;
    if (bank.empty()) return store(freshMotif(rng, ctx), bar)->notes;

    double pChange = info.isFirst ? 0.85 * std::pow(loose, 1.2) : 0.6 * std::pow(loose, 2.5);
    if (rng.chance(pChange)) {
        std::vector<Motif*> others;
        for (auto& b : bank) if (b.get() != current) others.push_back(b.get());
        double r = rng.next();
        if (!others.empty() && r < 0.3) {
            std::vector<double> w;
            for (auto* o : others) w.push_back(o->strength);
            current = others[rng.weighted(w)];
        } else if (r < 0.3 + 0.7 * (0.4 + 0.6 * m)) {
            store(varyMotif(current->notes, 0.35 + 0.4 * loose, rng, ctx), bar);
        } else {
            store(freshMotif(rng, ctx), bar);
        }
    }

    Motif* motif = current;
    motif->strength += 1;
    motif->uses += 1;
    double amount;
    if (info.isLast) amount = 0.12 + 0.35 * loose;
    else if (rng.chance(0.45 + 0.5 * m)) amount = 0;
    else amount = 0.03 + 0.3 * loose;
    if (amount == 0) return motif->notes;
    auto varied = varyMotif(motif->notes, amount, rng, ctx);
    if (!info.isLast && rng.chance(0.4 * loose * loose)) motif->notes = varied;
    return varied;
}

MotifMemory::Motif* MotifMemory::store(std::vector<Note> notes, int bar) {
    bank.push_back(std::make_unique<Motif>(Motif{std::move(notes), 1, bar, 1}));
    Motif* motif = bank.back().get();
    if (bank.size() > kBankSize) {
        int weakest = -1;
        for (int i = 0; i < static_cast<int>(bank.size()); i++) {
            if (bank[i].get() == motif || bank[i].get() == current) continue;
            if (weakest < 0 || bank[i]->strength < bank[weakest]->strength) weakest = i;
        }
        bank.erase(bank.begin() + weakest);
    }
    current = motif;
    return motif;
}

// ---- params.js -------------------------------------------------------------

const ParamSpec kParams[kNumParams] = {
    {"density", "Density", false, 0, 100, 55, "%"},
    {"looseness", "Looseness", false, 0, 100, 25, "%"},
    {"drift", "Drift", false, 0, 100, 25, "%"},
    {"swing", "Swing", false, 0, 100, 20, "%"},
    {"breath", "Breath", false, 0, 100, 40, "%"},
    {"memory", "Memory", false, 0, 100, 65, "%"},
    {"accent", "Accent", false, 0, 100, 50, "%"},
    {"ghosts", "Ghosts", false, 0, 100, 35, "%"},
    {"seed", "Seed", true, 0, 9999, 1, ""},
};

int paramIndex(const std::string& id) {
    for (int i = 0; i < kNumParams; i++) if (id == kParams[i].id) return i;
    return -1;
}

// ---- index.js + generators/organic/index.js + timeline.js -------------------

namespace {
constexpr int32_t kSaltPlan = 0x91a7;
constexpr int32_t kSaltRender = 0x4e7d;
constexpr int32_t kSaltFlam = 0xf1a3;
constexpr double kMaxDev = 0.4;
constexpr double kMaxDur = 0.5;
constexpr double kTimelineMaxDev = kMaxDev + 0.09;
constexpr double kMinGap = 0.02;
constexpr double kRetain = 4;
} // namespace

Engine::Engine() {
    for (int i = 0; i < kNumParams; i++) values[i] = kParams[i].def;
    laneList = defaultLanes();
    meterNow = makeMeter(4, 4);
    setParam(0, values[0]); // computes p, seed
    seed = static_cast<uint32_t>(values[8]);
    buildModulators();
    reset(0);
}

void Engine::buildModulators() {
    breath = std::make_unique<BreathEnvelope>(hash32({u2i(seed), 0xb2ea7}));
    noises.clear();
}

const Noise& Engine::noise(const char* name, int index, int octaves, double persistence) {
    std::string key = std::string(name) + ":" + std::to_string(index);
    auto it = noises.find(key);
    if (it != noises.end()) return it->second;
    uint32_t h = 0;
    for (const char* c = name; *c; c++) h = hash32({u2i(h), static_cast<int32_t>(static_cast<unsigned char>(*c))});
    return noises.emplace(key, Noise(hash32({u2i(seed), u2i(h), index}), octaves, persistence)).first->second;
}

bool Engine::setParam(const std::string& id, double value) {
    int i = paramIndex(id);
    return i >= 0 && setParam(i, value);
}

bool Engine::setParam(int index, double value) {
    if (index < 0 || index >= kNumParams || !std::isfinite(value)) return false;
    const ParamSpec& s = kParams[index];
    double v = std::min(s.max, std::max(s.min, value));
    if (s.isInt) v = jsRound(v);
    values[index] = v;
    p.density = values[0] / 100;
    p.looseness = values[1] / 100;
    p.drift = values[2] / 100;
    p.swing = values[3] / 100;
    p.breath = values[4] / 100;
    p.memory = values[5] / 100;
    p.accent = values[6] / 100;
    p.ghosts = values[7] / 100;
    p.seed = static_cast<uint32_t>(values[8]);
    if (index == 8 && p.seed != seed && breath) {
        seed = p.seed;
        buildModulators();
        memory = MotifMemory();
    }
    return true;
}

void Engine::setTempo(double b) {
    if (b > 0 && std::isfinite(b)) bpm = b;
}

void Engine::setMeter(int num, int den) {
    Meter m = makeMeter(num, den);
    if (m.key != meterNow.key) {
        pendingMeter = m;
        meterPending = true;
    } else {
        meterPending = false;
    }
}

// -- organic generator

void Engine::genInit() {
    memory = MotifMemory();
    plans.clear();
    nextBar = 0;
}

std::vector<Note> Engine::addFill(std::vector<Note> notes, const PhraseInfo& info, Rng& rng) {
    if (!info.isLast) return notes;
    double pFill = 0.15 + (info.shape == Shape::Build ? 0.35 : 0);
    if (!rng.chance(pFill)) return notes;
    auto byRole = [&](Role r) {
        for (int i = 0; i < static_cast<int>(laneList.size()); i++) if (laneList[i].role == r) return i;
        return -1;
    };
    int li = rng.chance(0.7) ? byRole(Role::Backbeat) : byRole(Role::Color);
    if (li < 0) li = byRole(Role::Backbeat) >= 0 ? byRole(Role::Backbeat) : byRole(Role::Color);
    if (li < 0) return notes;
    const Meter& m = meterNow;
    double spanEnd = m.barLen * (1 - info.restInBar);
    double spanLen = std::min(spanEnd, m.pulse * (rng.chance(0.5) ? 1 : 2));
    if (spanLen < m.pulse * 0.99) return notes;
    double spanStart = spanEnd - spanLen;
    static const struct { int div; Family fam; } kRates[] = {{4, Family::Main}, {6, Family::Cross}, {3, Family::Cross}};
    const auto& rate = kRates[rng.weighted({3, 1.5, 1})];
    int count = static_cast<int>(jsRound((spanLen / m.pulse) * rate.div));
    double gamma = rng.range(0.93, 1.07);
    std::vector<Note> kept;
    for (const auto& n : notes)
        if (n.lane != li || n.pos < spanStart || n.pos >= spanEnd) kept.push_back(n);
    double prio = 0.2 + 0.4 * rng.next();
    for (int i = 0; i < count; i++) {
        double u = static_cast<double>(i) / count;
        if (i < count - 1 && i > 0 && rng.chance(0.15)) continue;
        Note f;
        f.id = rng.intBelow(2147483647.0);
        f.lane = li;
        f.pos = spanStart + spanLen * std::pow(u, gamma);
        f.att = spanStart + spanLen * u;
        f.fam = rate.fam;
        f.kind = Kind::Fill;
        f.prio = prio;
        f.accent = i == count - 1 ? 0.6 : 0;
        f.flam = false;
        f.fillProg = u;
        kept.push_back(f);
    }
    return kept;
}

Engine::Plan Engine::makePlan(int k) {
    Rng rng(hash32({u2i(seed), kSaltPlan, k}));
    PhraseInfo info = breath->info(k);
    Ctx ctx{&meterNow, &laneList, &p};
    std::vector<Note> notes = memory.next(k, info, rng, ctx);
    notes = addFill(std::move(notes), info, rng);
    std::stable_sort(notes.begin(), notes.end(), [](const Note& a, const Note& b) {
        if (a.pos != b.pos) return a.pos < b.pos;
        if (a.lane != b.lane) return a.lane < b.lane;
        return static_cast<int>(a.kind) < static_cast<int>(b.kind);
    });
    for (size_t i = 0; i < notes.size(); i++) notes[i].uid = static_cast<int>(i);
    return {k, std::move(notes), info};
}

const Engine::Plan& Engine::getPlan(int k) {
    while (nextBar <= k) {
        plans[nextBar] = makePlan(nextBar);
        nextBar++;
    }
    for (auto it = plans.begin(); it != plans.end();) {
        if (it->first < k - 3) it = plans.erase(it);
        else ++it;
    }
    static const Plan empty{0, {}, {}};
    auto it = plans.find(k);
    return it == plans.end() ? empty : it->second;
}

void Engine::render(const Note& c, int k, double barStart, std::vector<Event>& out) {
    const Meter& m = meterNow;
    const Lane& lane = laneList[c.lane];
    const RoleProfile& rp = profile(lane.role);
    int li = c.lane;
    double anchor = barStart + c.pos;
    double t = anchor - origin;
    double barPos = t / m.barLen;
    double level = breath->densityAt(barPos);
    double f = std::max(0.0, 1 + (level - 1) * p.breath * rp.breathSens);
    double dl = clampd(p.density * f * lane.density, 0, 1);
    double env = breath->value(barPos);

    if (c.kind == Kind::Main && c.prio > dl) return;
    if (c.kind == Kind::Ghost && c.prio > p.ghosts * std::min(1.0, dl * 2)) return;
    if (c.kind == Kind::Fill && c.prio > dl * 1.3) return;

    Rng r(hash32({u2i(seed), kSaltRender, k, c.uid}));

    double x = c.pos;
    if (c.fam == Family::Main) {
        double sw = p.swing * (1 + 0.45 * noise("swing", 0, 3, 0.5)(t / 8));
        x = swingWarp(m, x, sw);
    }
    double drift = p.drift * (0.055 * noise("ensemble", 0, 4, 0.6)(t / 6) + 0.015 * noise("drift", li, 4, 0.6)(t / 4) + rp.bias +
                              0.012 * noise("bias", li, 2, 0.5)(t / 24));
    double jitter = p.looseness * 0.014 * r.gauss();
    double beat = anchor + clampd(x - c.pos + drift + jitter, -kMaxDev, kMaxDev);

    double A = p.accent;
    double v;
    if (c.kind == Kind::Ghost) v = rp.ghostVel * (0.85 + 0.3 * r.next()) * (1 - 0.25 * A);
    else if (c.kind == Kind::Fill) v = rp.velocity * (0.45 + 0.5 * c.fillProg) * (1 + 0.2 * A * c.fillProg);
    else v = rp.velocity * (1 + A * 0.55 * (metricWeight(m, c.pos) - 0.45));
    if (c.accent > 0) v += A * 26 * c.accent;
    v *= 1 + p.breath * 0.15 * (std::min(env, 1.3) - 0.9);
    v += 7 * noise("vel", li, 3, 0.6)(t / 2) + 3 * (0.5 + p.looseness) * r.gauss();
    int velocity = static_cast<int>(clampd(jsRound(v), 1, 127));
    double duration = std::min(kMaxDur, rp.duration * (c.kind == Kind::Ghost ? 0.6 : 1));
    out.push_back({beat, li, lane.note, velocity, duration});

    if (c.flam && c.kind == Kind::Main && static_cast<double>(hash32({u2i(seed), kSaltFlam, c.id})) / 4294967296.0 < p.ghosts * 0.55) {
        double gap = std::min(0.09, ((14 + 22 * r.next()) * bpm) / 60000);
        int gv = static_cast<int>(clampd(jsRound(velocity * (0.38 + 0.2 * r.next())), 1, 127));
        out.push_back({beat - gap, li, lane.note, gv, gap * 0.7});
    }
}

std::vector<Event> Engine::genGenerate(double start, double end) {
    std::vector<Event> out;
    double L = meterNow.barLen;
    int k0 = static_cast<int>(std::max(0.0, std::floor((start - origin) / L)));
    int k1 = static_cast<int>(std::floor((end - origin) / L));
    for (int k = k0; k <= k1; k++) {
        const Plan& plan = getPlan(k);
        double barStart = origin + k * L;
        for (const auto& c : plan.notes) {
            double a = barStart + c.pos;
            if (a >= start && a < end) render(c, k, barStart, out);
        }
    }
    return out;
}

// -- timeline

void Engine::reset(double start) {
    if (!std::isfinite(start)) start = 0;
    if (meterPending) {
        meterNow = pendingMeter;
        meterPending = false;
    }
    origin = std::floor(start / meterNow.barLen + kEps) * meterNow.barLen;
    genInit();
    cache.clear();
    renderedTo = start;
    floorBeat = start;
    lastEnd = start;
}

std::vector<Event> Engine::generate(double start, double end) {
    std::vector<Event> out;
    if (!(end > start) || !std::isfinite(start) || !std::isfinite(end)) return out;
    if (start > lastEnd + kEps) jump(start);
    renderUntil(end + kMaxDur + kTimelineMaxDev);
    for (size_t i = lowerBound(start); i < cache.size(); i++) {
        if (cache[i].ev.beat >= end) break;
        if (cache[i].dropped) continue;
        if (!cache[i].done) finalize(i);
        cache[i].returned = true;
        out.push_back(cache[i].ev);
    }
    if (end > lastEnd) lastEnd = end;
    trim(lastEnd - kRetain);
    return out;
}

void Engine::jump(double start) {
    cache.erase(std::remove_if(cache.begin(), cache.end(), [](const Cached& c) { return !c.returned; }), cache.end());
    renderedTo = start;
    floorBeat = start;
    lastEnd = start;
}

void Engine::renderUntil(double need) {
    while (renderedTo < need) {
        double c0 = renderedTo;
        double c1 = std::floor(c0 + kEps) + 1;
        std::vector<Event> evs = genGenerate(c0, c1);
        double lo = std::max(c0 - kTimelineMaxDev, floorBeat);
        std::vector<Cached> fresh;
        for (auto e : evs) {
            if (!std::isfinite(e.beat) || e.lane < 0 || e.lane >= static_cast<int>(laneList.size())) continue;
            e.note = std::min(127, std::max(0, e.note));
            e.velocity = std::min(127, std::max(1, e.velocity));
            if (!(e.duration > 0)) e.duration = 0.1;
            e.duration = std::min(kMaxDur, std::max(0.005, e.duration));
            e.beat = std::min(std::max(e.beat, lo), c1 + kTimelineMaxDev);
            fresh.push_back({e, seqCounter++, false, false, false});
        }
        insert(fresh);
        renderedTo = c1;
    }
}

void Engine::insert(std::vector<Cached>& fresh) {
    if (fresh.empty()) return;
    auto cmp = [](const Cached& a, const Cached& b) {
        if (a.ev.beat != b.ev.beat) return a.ev.beat < b.ev.beat;
        if (a.ev.lane != b.ev.lane) return a.ev.lane < b.ev.lane;
        return a.seq < b.seq;
    };
    std::stable_sort(fresh.begin(), fresh.end(), cmp);
    std::vector<Cached> merged;
    merged.reserve(cache.size() + fresh.size());
    std::merge(cache.begin(), cache.end(), fresh.begin(), fresh.end(), std::back_inserter(merged), cmp);
    cache.swap(merged);
}

void Engine::finalize(size_t i) {
    Cached& ev = cache[i];
    for (size_t j = i + 1; j < cache.size(); j++) {
        Cached& nx = cache[j];
        if (nx.ev.beat > ev.ev.beat + ev.ev.duration) break;
        if (nx.dropped || nx.ev.lane != ev.ev.lane) continue;
        if (nx.ev.beat - ev.ev.beat < kMinGap) {
            nx.dropped = true;
            continue;
        }
        ev.ev.duration = std::min(ev.ev.duration, (nx.ev.beat - ev.ev.beat) * 0.9);
        break;
    }
    ev.done = true;
}

size_t Engine::lowerBound(double beat) const {
    size_t lo = 0, hi = cache.size();
    while (lo < hi) {
        size_t mid = (lo + hi) >> 1;
        if (cache[mid].ev.beat < beat) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

void Engine::trim(double before) {
    size_t n = 0;
    while (n < cache.size() && cache[n].ev.beat < before && (cache[n].returned || cache[n].dropped)) n++;
    if (n) cache.erase(cache.begin(), cache.begin() + static_cast<long>(n));
}

} // namespace organic
