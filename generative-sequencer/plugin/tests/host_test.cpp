// Headless test host for the built Organic.vst3. Loads the plugin like a DAW
// would, plays it through a simulated transport (including a loop and a
// parameter change), and checks that the MIDI coming out of the binary is
// exactly what the engine's BlockScheduler produces for the same transport.
// Exit code 0 = pass.

#include <juce_audio_processors/juce_audio_processors.h>

#include <cstdio>
#include <filesystem>

#include "block_scheduler.h"

namespace {

struct SimPlayHead : juce::AudioPlayHead {
    juce::Optional<PositionInfo> getPosition() const override { return info; }
    PositionInfo info;
};

struct Out { long sample; int note, velocity; };

constexpr double kRate = 44100.0;
constexpr int kBlock = 480;

// Transport of block b: 120 bpm, playing from block 2, loop over beats 8..16
// starting at block 400, density raised at block 300.
organic::HostTransport transportFor(int b, double& song) {
    organic::HostTransport t;
    t.sampleRate = kRate;
    t.numSamples = kBlock;
    t.bpm = 120;
    t.hasPosition = true;
    t.playing = b >= 2;
    t.ppq = song;
    t.looping = b >= 400;
    t.loopStart = 8;
    t.loopEnd = 16;
    if (t.playing) {
        double before = song;
        song += kBlock * t.bpm / 60.0 / kRate;
        if (t.looping && before < t.loopEnd && song >= t.loopEnd) song = t.loopStart + (song - t.loopEnd);
    }
    return t;
}

int fail(const char* what) {
    std::printf("FAIL: %s\n", what);
    return 1;
}

} // namespace

int main(int argc, char** argv) {
    juce::ScopedJuceInitialiser_GUI juceInit;
    std::filesystem::path path = argc > 1 ? argv[1] : ORGANIC_VST3_PATH;
    path = std::filesystem::canonical(path);

    juce::VST3PluginFormat format;
    juce::OwnedArray<juce::PluginDescription> types;
    format.findAllTypesForFile(types, path.string());
    if (types.isEmpty()) return fail(("no plugin found in " + path.string()).c_str());
    std::printf("found %s (%s), %s, midi out: %s\n", types[0]->name.toRawUTF8(), types[0]->pluginFormatName.toRawUTF8(),
                types[0]->isInstrument ? "instrument" : "effect", path.filename().string().c_str());

    juce::String error;
    auto plugin = format.createInstanceFromDescription(*types[0], kRate, kBlock, error);
    if (!plugin) return fail(("could not load: " + error).toRawUTF8());
    if (!plugin->producesMidi()) return fail("plugin does not declare MIDI output");

    // Parameters: the engine's nine, by name (the VST3 layer adds its own,
    // e.g. bypass); set density via the host.
    auto& ps = plugin->getParameters();
    std::printf("  host sees %d parameters\n", ps.size());
    if (ps.size() > organic::kNumParams + 2) return fail("too many parameters (MIDI CC emulation should be off)");
    juce::AudioProcessorParameter* density = nullptr;
    for (const auto& spec : organic::kParams) {
        juce::AudioProcessorParameter* found = nullptr;
        for (auto* p : ps)
            if (p->getName(64) == spec.name) found = p;
        if (!found) return fail((std::string("missing parameter ") + spec.name).c_str());
        std::printf("  %s = %s\n", spec.name, found->getCurrentValueAsText().toRawUTF8());
        if (std::string(spec.id) == "density") density = found;
    }

    SimPlayHead head;
    plugin->setPlayHead(&head);
    plugin->setPlayConfigDetails(0, 2, kRate, kBlock);
    plugin->prepareToPlay(kRate, kBlock);

    organic::Engine refEngine;
    organic::BlockScheduler ref(refEngine);

    juce::AudioBuffer<float> audio(2, kBlock);
    juce::MidiBuffer midi;
    std::vector<Out> got, want;
    std::vector<organic::MidiNote> scratch;
    double song = 0, songRef = 0;
    for (int b = 0; b < 2400; b++) {
        if (b == 300) {
            density->setValueNotifyingHost(0.8f); // normalised: 80 of 0..100
            refEngine.setParam("density", 80);
        }
        organic::HostTransport t = transportFor(b, song);
        head.info = {};
        head.info.setIsPlaying(t.playing);
        head.info.setPpqPosition(t.ppq);
        head.info.setBpm(t.bpm);
        head.info.setTimeSignature(juce::AudioPlayHead::TimeSignature{4, 4});
        head.info.setIsLooping(t.looping);
        head.info.setLoopPoints(juce::AudioPlayHead::LoopPoints{t.loopStart, t.loopEnd});

        midi.clear();
        audio.clear();
        plugin->processBlock(audio, midi);
        for (const auto meta : midi) {
            const auto m = meta.getMessage();
            if (m.isNoteOn()) got.push_back({b * (long)kBlock + meta.samplePosition, m.getNoteNumber(), m.getVelocity()});
            else if (m.isNoteOff()) got.push_back({b * (long)kBlock + meta.samplePosition, m.getNoteNumber(), 0});
        }

        organic::HostTransport tr = transportFor(b, songRef);
        scratch.clear();
        ref.process(tr, scratch);
        for (const auto& m : scratch) want.push_back({b * (long)kBlock + m.sample, m.note, m.velocity});

        for (int ch = 0; ch < audio.getNumChannels(); ch++)
            if (audio.getMagnitude(ch, 0, kBlock) > 0) return fail("audio output is not silent");
    }
    plugin->releaseResources();

    long ons = 0;
    for (const auto& o : got) ons += o.velocity > 0;
    std::printf("plugin sent %zu MIDI events (%ld note-ons); reference %zu\n", got.size(), ons, want.size());
    if (ons < 200) return fail("too few notes");
    if (got.size() != want.size()) return fail("event count differs from the engine");
    for (size_t i = 0; i < got.size(); i++) {
        if (got[i].sample != want[i].sample || got[i].note != want[i].note || got[i].velocity != want[i].velocity) {
            std::printf("event %zu: plugin %ld/%d/%d vs engine %ld/%d/%d\n", i, got[i].sample, got[i].note, got[i].velocity,
                        want[i].sample, want[i].note, want[i].velocity);
            return fail("plugin MIDI differs from the engine");
        }
    }
    std::printf("host test passed\n");
    return 0;
}
