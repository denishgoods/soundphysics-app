#include "PluginProcessor.h"
#include "PluginEditor.h"

juce::AudioProcessor::BusesProperties OrganicProcessor::buses() {
#if JucePlugin_IsMidiEffect
    return BusesProperties();
#else
    // Hosts only load instruments that have an audio output; it stays silent.
    return BusesProperties().withOutput("Output", juce::AudioChannelSet::stereo(), true);
#endif
}

juce::AudioProcessorValueTreeState::ParameterLayout OrganicProcessor::createLayout() {
    juce::AudioProcessorValueTreeState::ParameterLayout layout;
    for (const auto& s : organic::kParams) {
        if (s.options) {
            layout.add(std::make_unique<juce::AudioParameterChoice>(juce::ParameterID{s.id, 1}, s.name,
                                                                    juce::StringArray::fromTokens(s.options, "|", ""),
                                                                    static_cast<int>(s.def)));
        } else if (s.isInt) {
            layout.add(std::make_unique<juce::AudioParameterInt>(juce::ParameterID{s.id, 1}, s.name, static_cast<int>(s.min),
                                                                 static_cast<int>(s.max), static_cast<int>(s.def)));
        } else {
            layout.add(std::make_unique<juce::AudioParameterFloat>(
                juce::ParameterID{s.id, 1}, s.name, juce::NormalisableRange<float>(static_cast<float>(s.min), static_cast<float>(s.max), 0.1f),
                static_cast<float>(s.def), juce::AudioParameterFloatAttributes().withLabel(s.unit).withStringFromValueFunction(
                                               [](float v, int) { return juce::String(juce::roundToInt(v)) + " %"; })));
        }
    }
    return layout;
}

OrganicProcessor::OrganicProcessor()
    : AudioProcessor(buses()), params(*this, nullptr, "Organic", createLayout()) {
    for (int i = 0; i < organic::kNumParams; i++) {
        paramValues[static_cast<size_t>(i)] = params.getRawParameterValue(organic::kParams[i].id);
        applied[static_cast<size_t>(i)] = static_cast<float>(organic::kParams[i].def);
    }
}

void OrganicProcessor::prepareToPlay(double sr, int samplesPerBlock) {
    sampleRate = sr;
    scratch.reserve(static_cast<size_t>(std::max(256, samplesPerBlock)));
}

bool OrganicProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const {
#if JucePlugin_IsMidiEffect
    return layouts.inputBuses.isEmpty() && layouts.outputBuses.isEmpty();
#else
    const auto out = layouts.getMainOutputChannelSet();
    return out == juce::AudioChannelSet::stereo() || out == juce::AudioChannelSet::mono();
#endif
}

void OrganicProcessor::processBlock(juce::AudioBuffer<float>& audio, juce::MidiBuffer& midi) { run(audio, midi, false); }

void OrganicProcessor::processBlockBypassed(juce::AudioBuffer<float>& audio, juce::MidiBuffer& midi) { run(audio, midi, true); }

void OrganicProcessor::run(juce::AudioBuffer<float>& audio, juce::MidiBuffer& midi, bool bypassed) {
    juce::ScopedNoDenormals noDenormals;
    audio.clear();
    scratch.clear();

    if (bypassed) {
        if (scheduler.isRunning()) scheduler.panic(scratch);
    } else {
        for (int i = 0; i < organic::kNumParams; i++) {
            const float v = paramValues[static_cast<size_t>(i)]->load();
            if (!juce::exactlyEqual(v, applied[static_cast<size_t>(i)])) {
                engine.setParam(i, v);
                applied[static_cast<size_t>(i)] = v;
            }
        }

        organic::HostTransport t;
        t.numSamples = audio.getNumSamples();
        t.sampleRate = sampleRate;
        if (auto* head = getPlayHead()) {
            if (const auto pos = head->getPosition()) {
                t.playing = pos->getIsPlaying();
                if (const auto ppq = pos->getPpqPosition()) {
                    t.ppq = *ppq;
                    t.hasPosition = true;
                }
                if (const auto bpm = pos->getBpm()) t.bpm = *bpm;
                if (const auto ts = pos->getTimeSignature()) {
                    t.tsNum = ts->numerator;
                    t.tsDen = ts->denominator;
                }
                if (const auto loop = pos->getLoopPoints()) {
                    t.looping = pos->getIsLooping();
                    t.loopStart = loop->ppqStart;
                    t.loopEnd = loop->ppqEnd;
                }
            }
        }
        // MIDI effects have no audio buffer in some hosts; use the MIDI block size.
        if (t.numSamples <= 0) t.numSamples = getBlockSize();
        scheduler.process(t, scratch);
        hostHasTransport.store(t.hasPosition);
        hostPlaying.store(t.playing && t.hasPosition);
        currentBar.store(static_cast<int>(scheduler.currentBar()));
        notesPlayed.store(scheduler.stats().notes);
    }

    for (const auto& m : scratch) {
        const auto msg = m.velocity > 0 ? juce::MidiMessage::noteOn(1, m.note, static_cast<juce::uint8>(m.velocity))
                                        : juce::MidiMessage::noteOff(1, m.note);
        midi.addEvent(msg, m.sample);
    }
}

juce::AudioProcessorEditor* OrganicProcessor::createEditor() { return new OrganicEditor(*this); }

void OrganicProcessor::getStateInformation(juce::MemoryBlock& destData) {
    if (auto xml = params.copyState().createXml()) copyXmlToBinary(*xml, destData);
}

void OrganicProcessor::setStateInformation(const void* data, int sizeInBytes) {
    if (auto xml = getXmlFromBinary(data, sizeInBytes))
        if (xml->hasTagName(params.state.getType())) params.replaceState(juce::ValueTree::fromXml(*xml));
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new OrganicProcessor(); }
