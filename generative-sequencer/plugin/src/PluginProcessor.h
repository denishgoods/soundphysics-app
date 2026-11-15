#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include <array>
#include <atomic>
#include <vector>

#include "block_scheduler.h"

// Organic as a plugin: the host's transport drives the engine through the
// block scheduler; generated notes go out as MIDI at exact sample offsets.
// Incoming MIDI passes through. The audio output (synth variant) is silent.
class OrganicProcessor : public juce::AudioProcessor {
public:
    OrganicProcessor();

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported(const BusesLayout& layouts) const override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    void processBlockBypassed(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return JucePlugin_Name; }
    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return true; }
    bool isMidiEffect() const override { return JucePlugin_IsMidiEffect != 0; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}

    void getStateInformation(juce::MemoryBlock& destData) override;
    void setStateInformation(const void* data, int sizeInBytes) override;

    juce::AudioProcessorValueTreeState params;

    // For the editor's status line (written on the audio thread).
    std::atomic<bool> hostPlaying{false};
    std::atomic<bool> hostHasTransport{false};
    std::atomic<int> currentBar{0};
    std::atomic<long> notesPlayed{0};

private:
    static juce::AudioProcessorValueTreeState::ParameterLayout createLayout();
    static BusesProperties buses();
    void run(juce::AudioBuffer<float>&, juce::MidiBuffer&, bool bypassed);

    organic::Engine engine;
    organic::BlockScheduler scheduler{engine};
    std::array<std::atomic<float>*, organic::kNumParams> paramValues{};
    std::array<float, organic::kNumParams> applied{};
    std::vector<organic::MidiNote> scratch;
    double sampleRate = 44100.0;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(OrganicProcessor)
};
