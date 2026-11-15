// Prints the C++ engine's events for a run, one per line:
//   beat lane note velocity duration     (beats with 17 significant digits)
// Used by test/plugin-parity.test.js to compare against the JS engine.
//
//   engine_dump --bars 32 --seed 7 --bpm 110 --meter 4/4 --start 0 --window 0.37
//               --set density=70 --at 16:swing=80
// --at B:id=v changes a parameter once the generated range reaches beat B.

#include "../engine/organic.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

struct Change { double at; std::string id; double value; bool done; };

static bool parseAssign(const char* s, std::string& id, double& v) {
    const char* eq = std::strchr(s, '=');
    if (!eq) return false;
    id.assign(s, eq - s);
    v = std::atof(eq + 1);
    return true;
}

int main(int argc, char** argv) {
    organic::Engine eng;
    double bars = 16, bpm = 120, start = 0, window = 0.25;
    int num = 4, den = 4;
    std::vector<Change> changes;
    for (int i = 1; i + 1 < argc; i += 2) {
        std::string k = argv[i];
        const char* v = argv[i + 1];
        if (k == "--bars") bars = std::atof(v);
        else if (k == "--seed") eng.setParam("seed", std::atof(v));
        else if (k == "--bpm") bpm = std::atof(v);
        else if (k == "--start") start = std::atof(v);
        else if (k == "--window") window = std::atof(v);
        else if (k == "--meter") std::sscanf(v, "%d/%d", &num, &den);
        else if (k == "--set") {
            std::string id; double x;
            if (parseAssign(v, id, x)) eng.setParam(id, x);
        } else if (k == "--at") {
            const char* colon = std::strchr(v, ':');
            std::string id; double x;
            if (colon && parseAssign(colon + 1, id, x)) changes.push_back({std::atof(v), id, x, false});
        } else {
            std::fprintf(stderr, "unknown option %s\n", k.c_str());
            return 2;
        }
    }
    eng.setTempo(bpm);
    eng.setMeter(num, den);
    eng.reset(start);
    double end = start + bars * eng.meter().barLen;
    for (double a = start; a < end; a += window) {
        for (auto& c : changes)
            if (!c.done && a >= c.at) { eng.setParam(c.id, c.value); c.done = true; }
        double b = a + window < end ? a + window : end;
        for (const auto& e : eng.generate(a, b))
            std::printf("%.17g %d %d %d %.17g\n", e.beat, e.lane, e.note, e.velocity, e.duration);
    }
    return 0;
}
