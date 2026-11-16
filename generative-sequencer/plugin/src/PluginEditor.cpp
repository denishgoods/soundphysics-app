#include "PluginEditor.h"

namespace {
const juce::Colour kBg(0xff1b1a18), kPanel(0xff26241f), kText(0xffece9e2), kMuted(0xff9a958a), kAccent(0xffd9822b);
constexpr int kKnobW = 64, kPad = 14;
}

OrganicEditor::OrganicEditor(OrganicProcessor& p) : AudioProcessorEditor(&p), proc(p) {
    look.setColour(juce::Slider::rotarySliderFillColourId, kAccent);
    look.setColour(juce::Slider::rotarySliderOutlineColourId, kPanel.brighter(0.15f));
    look.setColour(juce::Slider::thumbColourId, kText);
    look.setColour(juce::Slider::textBoxTextColourId, kText);
    look.setColour(juce::Slider::textBoxOutlineColourId, juce::Colours::transparentBlack);
    look.setColour(juce::Label::textColourId, kText);
    look.setColour(juce::ComboBox::backgroundColourId, kPanel);
    look.setColour(juce::ComboBox::textColourId, kText);
    look.setColour(juce::ComboBox::outlineColourId, kPanel.brighter(0.2f));
    look.setColour(juce::PopupMenu::backgroundColourId, kPanel);
    setLookAndFeel(&look);

    for (const auto& s : organic::kParams) {
        if (s.options) {
            mode.addItemList(juce::StringArray::fromTokens(s.options, "|", ""), 1);
            mode.setTooltip("Pattern type");
            addAndMakeVisible(mode);
            modeAttachment = std::make_unique<juce::AudioProcessorValueTreeState::ComboBoxAttachment>(proc.params, s.id, mode);
            continue;
        }
        Knob k;
        k.slider = std::make_unique<juce::Slider>(juce::Slider::RotaryHorizontalVerticalDrag, juce::Slider::TextBoxBelow);
        k.slider->setTextBoxStyle(juce::Slider::TextBoxBelow, false, kKnobW, 18);
        k.slider->setTooltip(s.name);
        addAndMakeVisible(*k.slider);
        k.label = std::make_unique<juce::Label>(juce::String(), s.name);
        k.label->setJustificationType(juce::Justification::centred);
        k.label->setFont(juce::FontOptions(13.0f));
        addAndMakeVisible(*k.label);
        k.attachment = std::make_unique<juce::AudioProcessorValueTreeState::SliderAttachment>(proc.params, s.id, *k.slider);
        knobs.push_back(std::move(k));
    }
    status.setColour(juce::Label::textColourId, kMuted);
    status.setFont(juce::FontOptions(13.0f));
    addAndMakeVisible(status);

    const int n = static_cast<int>(knobs.size());
    setSize(kPad * 2 + kKnobW * n + 6 * (n - 1), 190);
    startTimerHz(10);
    timerCallback();
}

OrganicEditor::~OrganicEditor() {
    stopTimer();
    setLookAndFeel(nullptr);
}

void OrganicEditor::paint(juce::Graphics& g) {
    g.fillAll(kBg);
    g.setColour(kText);
    g.setFont(juce::FontOptions(16.0f, juce::Font::bold));
    g.drawText("ORGANIC", kPad, 8, 100, 22, juce::Justification::centredLeft);
    g.setColour(kMuted);
    g.setFont(juce::FontOptions(12.0f));
    g.drawText(juce::String("generative drums  v") + organic::kVersion, getWidth() - 220 - kPad, 8, 220, 22,
               juce::Justification::centredRight);
}

void OrganicEditor::resized() {
    int x = kPad;
    for (auto& k : knobs) {
        k.label->setBounds(x - 4, 40, kKnobW + 8, 18);
        k.slider->setBounds(x, 58, kKnobW, kKnobW + 18);
        x += kKnobW + 6;
    }
    status.setBounds(kPad, getHeight() - 32, getWidth() - kPad * 2, 22);
    mode.setBounds(120, 8, 130, 22);
}

void OrganicEditor::timerCallback() {
    juce::String text;
    if (!proc.hostHasTransport.load()) text = "waiting for the host transport - press play";
    else if (proc.hostPlaying.load())
        text = "playing - bar " + juce::String(proc.currentBar.load()) + " - " + juce::String(static_cast<juce::int64>(proc.notesPlayed.load())) + " notes";
    else text = "ready - press play";
    status.setText(text, juce::dontSendNotification);
}
