# Native plugin build (JUCE). Produces:
#   Organic          VST3 (all platforms): an instrument with MIDI output. This
#                    is how Ableton Live, Bitwig, Reaper and Cubase use MIDI
#                    generators: load it on a track, route its MIDI elsewhere.
#   Organic MIDI FX  AU MIDI effect (macOS): for Logic's MIDI FX slot.
#
#   cmake -B build -DCMAKE_BUILD_TYPE=Release
#   cmake --build build --config Release
#
# JUCE is fetched at configure time. Note JUCE's licence (AGPLv3 unless you
# hold a JUCE licence) applies to binaries you distribute.

cmake_minimum_required(VERSION 3.22)

set(CMAKE_OSX_DEPLOYMENT_TARGET "10.13" CACHE STRING "Minimum macOS version")
project(Organic VERSION 0.2.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)
FetchContent_Declare(JUCE
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG 8.0.15
    GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(JUCE)

# The engine. Fused multiply-add must stay off so results match the JS engine
# (and the Max device) exactly.
add_library(organic_engine STATIC engine/organic.cpp engine/block_scheduler.cpp)
target_include_directories(organic_engine PUBLIC engine)
set_target_properties(organic_engine PROPERTIES POSITION_INDEPENDENT_CODE ON)
if(MSVC)
    target_compile_options(organic_engine PRIVATE /fp:precise)
else()
    target_compile_options(organic_engine PRIVATE -ffp-contract=off)
endif()

function(organic_add_plugin target)
    cmake_parse_arguments(ARG "" "PRODUCT_NAME;PLUGIN_CODE;IS_MIDI_EFFECT" "FORMATS" ${ARGN})
    if(ARG_IS_MIDI_EFFECT)
        set(is_synth FALSE)
    else()
        set(is_synth TRUE)
    endif()
    juce_add_plugin(${target}
        PRODUCT_NAME "${ARG_PRODUCT_NAME}"
        COMPANY_NAME "Sound Physics"
        BUNDLE_ID "com.soundphysics.${target}"
        PLUGIN_MANUFACTURER_CODE Sphy
        PLUGIN_CODE ${ARG_PLUGIN_CODE}
        IS_SYNTH ${is_synth}
        IS_MIDI_EFFECT ${ARG_IS_MIDI_EFFECT}
        NEEDS_MIDI_INPUT TRUE
        NEEDS_MIDI_OUTPUT TRUE
        EDITOR_WANTS_KEYBOARD_FOCUS FALSE
        COPY_PLUGIN_AFTER_BUILD FALSE
        VST3_CATEGORIES Instrument Generator
        FORMATS ${ARG_FORMATS})
    target_sources(${target} PRIVATE src/PluginProcessor.cpp src/PluginEditor.cpp)
    target_compile_definitions(${target} PUBLIC
        JUCE_WEB_BROWSER=0
        JUCE_USE_CURL=0
        JUCE_VST3_CAN_REPLACE_VST2=0
        JUCE_VST3_EMULATE_MIDI_CC_WITH_PARAMETERS=0)
    target_link_libraries(${target}
        PRIVATE organic_engine juce::juce_audio_utils
        PUBLIC juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)
endfunction()

organic_add_plugin(Organic PRODUCT_NAME "Organic" PLUGIN_CODE Orgn IS_MIDI_EFFECT FALSE FORMATS VST3)
if(APPLE)
    organic_add_plugin(OrganicMidiFx PRODUCT_NAME "Organic MIDI FX" PLUGIN_CODE Orgm IS_MIDI_EFFECT TRUE FORMATS AU)
endif()

# Headless test host: loads the built VST3, drives it with a simulated
# transport and compares its MIDI with the engine (cmake -DORGANIC_HOST_TEST=ON).
option(ORGANIC_HOST_TEST "Build the headless VST3 test host" OFF)
if(ORGANIC_HOST_TEST)
    juce_add_console_app(OrganicHostTest PRODUCT_NAME "OrganicHostTest")
    target_sources(OrganicHostTest PRIVATE tests/host_test.cpp)
    target_compile_definitions(OrganicHostTest PRIVATE
        JUCE_PLUGINHOST_VST3=1 JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0
        ORGANIC_VST3_PATH="$<TARGET_FILE_DIR:Organic_VST3>/../..")
    target_link_libraries(OrganicHostTest PRIVATE organic_engine juce::juce_audio_processors
        PUBLIC juce::juce_recommended_config_flags)
    add_dependencies(OrganicHostTest Organic_VST3)
endif()
