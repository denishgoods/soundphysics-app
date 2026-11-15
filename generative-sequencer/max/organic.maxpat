{
	"patcher": {
		"fileversion": 1,
		"appversion": {
			"major": 9,
			"minor": 0,
			"revision": 7,
			"architecture": "x64",
			"modernui": 1
		},
		"classnamespace": "box",
		"rect": [
			80,
			80,
			1400,
			960
		],
		"openinpresentation": 1,
		"default_fontsize": 12,
		"gridsize": [
			15,
			15
		],
		"boxes": [
			{
				"box": {
					"maxclass": "comment",
					"text": "Organic: generative MIDI sequencer (v8). Logic lives in organic.js (built from engine/).",
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [
						20,
						4,
						626,
						20
					],
					"id": "obj-1"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "v8 organic.js",
					"numinlets": 1,
					"numoutlets": 3,
					"outlettype": [
						"",
						"",
						""
					],
					"patching_rect": [
						20,
						330,
						103,
						22
					],
					"saved_object_attributes": {
						"parameter_enable": 0
					},
					"id": "obj-2"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "live.thisdevice",
					"numinlets": 1,
					"numoutlets": 3,
					"outlettype": [
						"bang",
						"int",
						"int"
					],
					"patching_rect": [
						20,
						40,
						117,
						22
					],
					"id": "obj-3"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "t 1 b b b",
					"numinlets": 1,
					"numoutlets": 4,
					"outlettype": [
						"int",
						"bang",
						"bang",
						"bang"
					],
					"patching_rect": [
						20,
						72,
						75,
						22
					],
					"id": "obj-4"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "qmetro 10",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						"bang"
					],
					"patching_rect": [
						20,
						110,
						75,
						22
					],
					"id": "obj-5"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "t b b",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"bang",
						"bang"
					],
					"patching_rect": [
						20,
						145,
						47,
						22
					],
					"id": "obj-6"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "transport",
					"numinlets": 2,
					"numoutlets": 8,
					"outlettype": [
						"int",
						"int",
						"float",
						"float",
						"float",
						"",
						"int",
						"float"
					],
					"patching_rect": [
						110,
						180,
						75,
						22
					],
					"id": "obj-7"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "prepend transport resolution",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						110,
						240,
						208,
						22
					],
					"id": "obj-8"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "prepend transport tempo",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						260,
						240,
						173,
						22
					],
					"id": "obj-9"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "prepend transport timesig",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						410,
						240,
						187,
						22
					],
					"id": "obj-10"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "prepend transport state",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						560,
						240,
						173,
						22
					],
					"id": "obj-11"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "prepend transport ticks",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						710,
						240,
						173,
						22
					],
					"id": "obj-12"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "live.path live_set",
					"numinlets": 1,
					"numoutlets": 3,
					"outlettype": [
						"",
						"",
						""
					],
					"patching_rect": [
						860,
						110,
						138,
						22
					],
					"id": "obj-13"
				}
			},
			{
				"box": {
					"maxclass": "message",
					"text": "property loop",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						860,
						145,
						107,
						22
					],
					"id": "obj-14"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "live.observer",
					"numinlets": 2,
					"numoutlets": 2,
					"outlettype": [
						"",
						""
					],
					"patching_rect": [
						860,
						180,
						103,
						22
					],
					"id": "obj-15"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "prepend lom loop",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						860,
						240,
						124,
						22
					],
					"id": "obj-16"
				}
			},
			{
				"box": {
					"maxclass": "message",
					"text": "property loop_start",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						1030,
						145,
						149,
						22
					],
					"id": "obj-17"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "live.observer",
					"numinlets": 2,
					"numoutlets": 2,
					"outlettype": [
						"",
						""
					],
					"patching_rect": [
						1030,
						180,
						103,
						22
					],
					"id": "obj-18"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "prepend lom loop_start",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						1030,
						240,
						166,
						22
					],
					"id": "obj-19"
				}
			},
			{
				"box": {
					"maxclass": "message",
					"text": "property loop_length",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						1200,
						145,
						156,
						22
					],
					"id": "obj-20"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "live.observer",
					"numinlets": 2,
					"numoutlets": 2,
					"outlettype": [
						"",
						""
					],
					"patching_rect": [
						1200,
						180,
						103,
						22
					],
					"id": "obj-21"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "prepend lom loop_length",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						1200,
						240,
						173,
						22
					],
					"id": "obj-22"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "unpack 0 0 0. 0.",
					"numinlets": 1,
					"numoutlets": 4,
					"outlettype": [
						"int",
						"int",
						"float",
						"float"
					],
					"patching_rect": [
						20,
						380,
						124,
						22
					],
					"id": "obj-23"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "pipe 0 0 0. 0.",
					"numinlets": 4,
					"numoutlets": 3,
					"outlettype": [
						"int",
						"int",
						"float"
					],
					"patching_rect": [
						20,
						420,
						110,
						22
					],
					"id": "obj-24"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "pack 0 0",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						20,
						470,
						68,
						22
					],
					"id": "obj-25"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "midiformat",
					"numinlets": 7,
					"numoutlets": 1,
					"outlettype": [
						"int"
					],
					"patching_rect": [
						20,
						510,
						82,
						22
					],
					"id": "obj-26"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "midiout",
					"numinlets": 1,
					"numoutlets": 0,
					"outlettype": [],
					"patching_rect": [
						20,
						550,
						61,
						22
					],
					"id": "obj-27"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "midiin",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						"int"
					],
					"patching_rect": [
						200,
						510,
						54,
						22
					],
					"id": "obj-28"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "t b f",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"bang",
						"float"
					],
					"patching_rect": [
						200,
						470,
						47,
						22
					],
					"id": "obj-29"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "transport",
					"numinlets": 2,
					"numoutlets": 8,
					"outlettype": [
						"int",
						"int",
						"float",
						"float",
						"float",
						"",
						"int",
						"float"
					],
					"patching_rect": [
						200,
						600,
						75,
						22
					],
					"id": "obj-30"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "pack 0. 0.",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						200,
						640,
						82,
						22
					],
					"id": "obj-31"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "prepend probe",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						200,
						680,
						103,
						22
					],
					"id": "obj-32"
				}
			},
			{
				"box": {
					"maxclass": "comment",
					"text": "diagnostics: click in locked mode, output in the Max Console",
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [
						420,
						300,
						430,
						20
					],
					"id": "obj-33"
				}
			},
			{
				"box": {
					"maxclass": "message",
					"text": "stats",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						420,
						325,
						51,
						22
					],
					"id": "obj-34"
				}
			},
			{
				"box": {
					"maxclass": "message",
					"text": "verbose 4",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						515,
						325,
						79,
						22
					],
					"id": "obj-35"
				}
			},
			{
				"box": {
					"maxclass": "message",
					"text": "verbose 0",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						610,
						325,
						79,
						22
					],
					"id": "obj-36"
				}
			},
			{
				"box": {
					"maxclass": "message",
					"text": "resetstats",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						705,
						325,
						86,
						22
					],
					"id": "obj-37"
				}
			},
			{
				"box": {
					"maxclass": "message",
					"text": "lookahead 250",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						800,
						325,
						107,
						22
					],
					"id": "obj-38"
				}
			},
			{
				"box": {
					"maxclass": "message",
					"text": "panic",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						895,
						325,
						51,
						22
					],
					"id": "obj-39"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "prepend set",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						600,
						380,
						89,
						22
					],
					"id": "obj-40"
				}
			},
			{
				"box": {
					"maxclass": "comment",
					"text": "organic.js is NOT running: needs Max 9 (v8) and organic.js next to the device. See Max Console.",
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [
						600,
						420,
						675,
						20
					],
					"presentation": 1,
					"presentation_rect": [
						8,
						84,
						470,
						34
					],
					"varname": "status",
					"id": "obj-41"
				}
			},
			{
				"box": {
					"maxclass": "comment",
					"text": "ORGANIC",
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [
						20,
						760,
						60,
						20
					],
					"presentation": 1,
					"presentation_rect": [
						8,
						4,
						120,
						20
					],
					"fontface": 1,
					"fontsize": 12,
					"id": "obj-42"
				}
			},
			{
				"box": {
					"maxclass": "live.dial",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"",
						"float"
					],
					"parameter_enable": 1,
					"patching_rect": [
						20,
						800,
						44,
						48
					],
					"presentation": 1,
					"presentation_rect": [
						8,
						26,
						44,
						48
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_longname": "Density",
							"parameter_shortname": "Density",
							"parameter_type": 0,
							"parameter_mmin": 0,
							"parameter_mmax": 100,
							"parameter_initial": [
								55
							],
							"parameter_initial_enable": 1,
							"parameter_unitstyle": 5,
							"parameter_info": "How many notes play. 0 is silence; 100 plays every candidate of the current figure."
						}
					},
					"varname": "Density",
					"id": "obj-43"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "prepend param density",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						20,
						880,
						159,
						22
					],
					"id": "obj-44"
				}
			},
			{
				"box": {
					"maxclass": "live.dial",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"",
						"float"
					],
					"parameter_enable": 1,
					"patching_rect": [
						110,
						800,
						44,
						48
					],
					"presentation": 1,
					"presentation_rect": [
						62,
						26,
						44,
						48
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_longname": "Looseness",
							"parameter_shortname": "Looseness",
							"parameter_type": 0,
							"parameter_mmin": 0,
							"parameter_mmax": 100,
							"parameter_initial": [
								35
							],
							"parameter_initial_enable": 1,
							"parameter_unitstyle": 5,
							"parameter_info": "Per-note timing scatter, and how often figures use triplets and quintuplets."
						}
					},
					"varname": "Looseness",
					"id": "obj-45"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "prepend param looseness",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						110,
						880,
						173,
						22
					],
					"id": "obj-46"
				}
			},
			{
				"box": {
					"maxclass": "live.dial",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"",
						"float"
					],
					"parameter_enable": 1,
					"patching_rect": [
						200,
						800,
						44,
						48
					],
					"presentation": 1,
					"presentation_rect": [
						116,
						26,
						44,
						48
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_longname": "Drift",
							"parameter_shortname": "Drift",
							"parameter_type": 0,
							"parameter_mmin": 0,
							"parameter_mmax": 100,
							"parameter_initial": [
								30
							],
							"parameter_initial_enable": 1,
							"parameter_unitstyle": 5,
							"parameter_info": "Slow correlated timing drift: the ensemble rushes and drags, each lane pushes or pulls."
						}
					},
					"varname": "Drift",
					"id": "obj-47"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "prepend param drift",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						200,
						880,
						145,
						22
					],
					"id": "obj-48"
				}
			},
			{
				"box": {
					"maxclass": "live.dial",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"",
						"float"
					],
					"parameter_enable": 1,
					"patching_rect": [
						290,
						800,
						44,
						48
					],
					"presentation": 1,
					"presentation_rect": [
						170,
						26,
						44,
						48
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_longname": "Swing",
							"parameter_shortname": "Swing",
							"parameter_type": 0,
							"parameter_mmin": 0,
							"parameter_mmax": 100,
							"parameter_initial": [
								20
							],
							"parameter_initial_enable": 1,
							"parameter_unitstyle": 5,
							"parameter_info": "Average swing (100 = triplet feel). The actual amount wanders over time."
						}
					},
					"varname": "Swing",
					"id": "obj-49"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "prepend param swing",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						290,
						880,
						145,
						22
					],
					"id": "obj-50"
				}
			},
			{
				"box": {
					"maxclass": "live.dial",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"",
						"float"
					],
					"parameter_enable": 1,
					"patching_rect": [
						380,
						800,
						44,
						48
					],
					"presentation": 1,
					"presentation_rect": [
						224,
						26,
						44,
						48
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_longname": "Breath",
							"parameter_shortname": "Breath",
							"parameter_type": 0,
							"parameter_mmin": 0,
							"parameter_mmax": 100,
							"parameter_initial": [
								50
							],
							"parameter_initial_enable": 1,
							"parameter_unitstyle": 5,
							"parameter_info": "Depth of phrase-level density breathing: builds, thinning out and rests."
						}
					},
					"varname": "Breath",
					"id": "obj-51"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "prepend param breath",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						380,
						880,
						152,
						22
					],
					"id": "obj-52"
				}
			},
			{
				"box": {
					"maxclass": "live.dial",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"",
						"float"
					],
					"parameter_enable": 1,
					"patching_rect": [
						470,
						800,
						44,
						48
					],
					"presentation": 1,
					"presentation_rect": [
						278,
						26,
						44,
						48
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_longname": "Memory",
							"parameter_shortname": "Memory",
							"parameter_type": 0,
							"parameter_mmin": 0,
							"parameter_mmax": 100,
							"parameter_initial": [
								65
							],
							"parameter_initial_enable": 1,
							"parameter_unitstyle": 5,
							"parameter_info": "How strongly figures return. 0 invents every bar; 100 repeats with only small variations."
						}
					},
					"varname": "Memory",
					"id": "obj-53"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "prepend param memory",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						470,
						880,
						152,
						22
					],
					"id": "obj-54"
				}
			},
			{
				"box": {
					"maxclass": "live.dial",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"",
						"float"
					],
					"parameter_enable": 1,
					"patching_rect": [
						560,
						800,
						44,
						48
					],
					"presentation": 1,
					"presentation_rect": [
						332,
						26,
						44,
						48
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_longname": "Accent",
							"parameter_shortname": "Accent",
							"parameter_type": 0,
							"parameter_mmin": 0,
							"parameter_mmax": 100,
							"parameter_initial": [
								50
							],
							"parameter_initial_enable": 1,
							"parameter_unitstyle": 5,
							"parameter_info": "Velocity contrast: metric emphasis depth and accent strength."
						}
					},
					"varname": "Accent",
					"id": "obj-55"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "prepend param accent",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						560,
						880,
						152,
						22
					],
					"id": "obj-56"
				}
			},
			{
				"box": {
					"maxclass": "live.dial",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"",
						"float"
					],
					"parameter_enable": 1,
					"patching_rect": [
						650,
						800,
						44,
						48
					],
					"presentation": 1,
					"presentation_rect": [
						386,
						26,
						44,
						48
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_longname": "Ghosts",
							"parameter_shortname": "Ghosts",
							"parameter_type": 0,
							"parameter_mmin": 0,
							"parameter_mmax": 100,
							"parameter_initial": [
								35
							],
							"parameter_initial_enable": 1,
							"parameter_unitstyle": 5,
							"parameter_info": "Amount of ghost notes and flams."
						}
					},
					"varname": "Ghosts",
					"id": "obj-57"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "prepend param ghosts",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						650,
						880,
						152,
						22
					],
					"id": "obj-58"
				}
			},
			{
				"box": {
					"maxclass": "comment",
					"text": "Seed",
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [
						740,
						800,
						60,
						20
					],
					"presentation": 1,
					"presentation_rect": [
						440,
						28,
						50,
						18
					],
					"id": "obj-59"
				}
			},
			{
				"box": {
					"maxclass": "live.numbox",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"",
						"float"
					],
					"parameter_enable": 1,
					"patching_rect": [
						740,
						830,
						50,
						15
					],
					"presentation": 1,
					"presentation_rect": [
						440,
						48,
						48,
						15
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_longname": "Seed",
							"parameter_shortname": "Seed",
							"parameter_type": 1,
							"parameter_mmin": 0,
							"parameter_mmax": 9999,
							"parameter_initial": [
								1
							],
							"parameter_initial_enable": 1,
							"parameter_unitstyle": 0,
							"parameter_info": "Random seed. Same seed and settings give the same performance."
						}
					},
					"varname": "Seed",
					"id": "obj-60"
				}
			},
			{
				"box": {
					"maxclass": "newobj",
					"text": "prepend param seed",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						740,
						880,
						138,
						22
					],
					"id": "obj-61"
				}
			}
		],
		"lines": [
			{
				"patchline": {
					"destination": [
						"obj-4",
						0
					],
					"source": [
						"obj-3",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-5",
						0
					],
					"source": [
						"obj-4",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-6",
						0
					],
					"source": [
						"obj-5",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-7",
						0
					],
					"source": [
						"obj-6",
						1
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-2",
						0
					],
					"source": [
						"obj-6",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-8",
						0
					],
					"source": [
						"obj-7",
						3
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-2",
						0
					],
					"source": [
						"obj-8",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-9",
						0
					],
					"source": [
						"obj-7",
						4
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-2",
						0
					],
					"source": [
						"obj-9",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-10",
						0
					],
					"source": [
						"obj-7",
						5
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-2",
						0
					],
					"source": [
						"obj-10",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-11",
						0
					],
					"source": [
						"obj-7",
						6
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-2",
						0
					],
					"source": [
						"obj-11",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-12",
						0
					],
					"source": [
						"obj-7",
						7
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-2",
						0
					],
					"source": [
						"obj-12",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-13",
						0
					],
					"source": [
						"obj-4",
						2
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-14",
						0
					],
					"source": [
						"obj-4",
						3
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-15",
						0
					],
					"source": [
						"obj-14",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-15",
						1
					],
					"source": [
						"obj-13",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-16",
						0
					],
					"source": [
						"obj-15",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-2",
						0
					],
					"source": [
						"obj-16",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-17",
						0
					],
					"source": [
						"obj-4",
						3
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-18",
						0
					],
					"source": [
						"obj-17",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-18",
						1
					],
					"source": [
						"obj-13",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-19",
						0
					],
					"source": [
						"obj-18",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-2",
						0
					],
					"source": [
						"obj-19",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-20",
						0
					],
					"source": [
						"obj-4",
						3
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-21",
						0
					],
					"source": [
						"obj-20",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-21",
						1
					],
					"source": [
						"obj-13",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-22",
						0
					],
					"source": [
						"obj-21",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-2",
						0
					],
					"source": [
						"obj-22",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-23",
						0
					],
					"source": [
						"obj-2",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-24",
						3
					],
					"source": [
						"obj-23",
						3
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-24",
						2
					],
					"source": [
						"obj-23",
						2
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-24",
						1
					],
					"source": [
						"obj-23",
						1
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-24",
						0
					],
					"source": [
						"obj-23",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-24",
						0
					],
					"source": [
						"obj-2",
						1
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-25",
						1
					],
					"source": [
						"obj-24",
						1
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-25",
						0
					],
					"source": [
						"obj-24",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-26",
						0
					],
					"source": [
						"obj-25",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-27",
						0
					],
					"source": [
						"obj-26",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-27",
						0
					],
					"source": [
						"obj-28",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-29",
						0
					],
					"source": [
						"obj-24",
						2
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-30",
						0
					],
					"source": [
						"obj-29",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-31",
						1
					],
					"source": [
						"obj-29",
						1
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-31",
						0
					],
					"source": [
						"obj-30",
						7
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-32",
						0
					],
					"source": [
						"obj-31",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-2",
						0
					],
					"source": [
						"obj-32",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-2",
						0
					],
					"source": [
						"obj-34",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-2",
						0
					],
					"source": [
						"obj-35",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-2",
						0
					],
					"source": [
						"obj-36",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-2",
						0
					],
					"source": [
						"obj-37",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-2",
						0
					],
					"source": [
						"obj-38",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-2",
						0
					],
					"source": [
						"obj-39",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-40",
						0
					],
					"source": [
						"obj-2",
						2
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-41",
						0
					],
					"source": [
						"obj-40",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-43",
						0
					],
					"source": [
						"obj-4",
						1
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-44",
						0
					],
					"source": [
						"obj-43",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-2",
						0
					],
					"source": [
						"obj-44",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-45",
						0
					],
					"source": [
						"obj-4",
						1
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-46",
						0
					],
					"source": [
						"obj-45",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-2",
						0
					],
					"source": [
						"obj-46",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-47",
						0
					],
					"source": [
						"obj-4",
						1
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-48",
						0
					],
					"source": [
						"obj-47",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-2",
						0
					],
					"source": [
						"obj-48",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-49",
						0
					],
					"source": [
						"obj-4",
						1
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-50",
						0
					],
					"source": [
						"obj-49",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-2",
						0
					],
					"source": [
						"obj-50",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-51",
						0
					],
					"source": [
						"obj-4",
						1
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-52",
						0
					],
					"source": [
						"obj-51",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-2",
						0
					],
					"source": [
						"obj-52",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-53",
						0
					],
					"source": [
						"obj-4",
						1
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-54",
						0
					],
					"source": [
						"obj-53",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-2",
						0
					],
					"source": [
						"obj-54",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-55",
						0
					],
					"source": [
						"obj-4",
						1
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-56",
						0
					],
					"source": [
						"obj-55",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-2",
						0
					],
					"source": [
						"obj-56",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-57",
						0
					],
					"source": [
						"obj-4",
						1
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-58",
						0
					],
					"source": [
						"obj-57",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-2",
						0
					],
					"source": [
						"obj-58",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-60",
						0
					],
					"source": [
						"obj-4",
						1
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-61",
						0
					],
					"source": [
						"obj-60",
						0
					]
				}
			},
			{
				"patchline": {
					"destination": [
						"obj-2",
						0
					],
					"source": [
						"obj-61",
						0
					]
				}
			}
		],
		"autosave": 0
	}
}
