'use strict';

// Entry for the preview page's bundle: the same engine the Max device and the
// plugin run, plus the MIDI writer and the placeholder kit.
module.exports = {
  E: require('../../engine'),
  midi: require('../../cli/lib/midifile'),
  kit: require('../../cli/lib/kit'),
};
