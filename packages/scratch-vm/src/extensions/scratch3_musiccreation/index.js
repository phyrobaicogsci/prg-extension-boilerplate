const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const Clone = require('../../util/clone');
const Cast = require('../../util/cast');
const formatMessage = require('format-message');
const MathUtil = require('../../util/math-util');
const Timer = require('../../util/timer');
const log = require('../../util/log');

const hrtime = require('browser-hrtime');
const mvae = require('@magenta/music/node/music_vae');
const core = require('@magenta/music/node/core');
const rnn = require('@magenta/music/node/music_rnn');


/**
 * The instrument and drum sounds, loaded as static assets.
 * @type {object}
 */
let assetData = {};

try {
    assetData = require('./manifest');
} catch (e) {
    // Non-webpack environment, don't worry about assets.
}




class Scratch3MusicCreation {
    constructor (runtime) {
        this.runtime = runtime;

        /**
         * An array of arrays of sound players. Each instrument has one or more audio players.
         * @type {Array[]}
         * @private
         */
        this._instrumentPlayerArrays = [];

        /**
         * An array of arrays of sound players. Each instrument mya have an audio player for each playable note.
         * @type {Array[]}
         * @private
         */
        this._instrumentPlayerNoteArrays = [];
        this._loadAllSounds();

        this.noteList = [];
        log.log(this.noteList);

        this._onTargetCreated = this._onTargetCreated.bind(this);
        this.runtime.on('targetWasCreated', this._onTargetCreated);

        this._playNoteForPicker = this._playNoteForPicker.bind(this);
        this.runtime.on('PLAY_NOTE', this._playNoteForPicker);

        instrumentNames = this._buildMenu(this.INSTRUMENT_INFO);
        
        volumes = [{text: "pianissimo", value: 15}, 
                    {text: "piano", value: 30}, 
                    {text: "mezzo-piano", value: 45},
                    {text: "mezzo-forte", value: 60},
                    {text: "forte", value: 85},
                    {text: "fortissimo", value: 100}];
        

    }

    /**
     * When a music-playing Target is cloned, clone the music state.
     * @param {Target} newTarget - the newly created target.
     * @param {Target} [sourceTarget] - the target used as a source for the new clone, if any.
     * @listens Runtime#event:targetWasCreated
     * @private
     */
    _onTargetCreated (newTarget, sourceTarget) {
        if (sourceTarget) {
            const musicState = sourceTarget.getCustomState(Scratch3MusicCreation.STATE_KEY);
            if (musicState) {
                newTarget.setCustomState(Scratch3MusicCreation.STATE_KEY, Clone.simple(musicState));
            }
        }
    }


    /**
     * Decode the full set of drum and instrument sounds, and store the audio buffers in arrays.
     */
    _loadAllSounds () {
        const loadingPromises = [];
        this.INSTRUMENT_INFO.forEach((instrumentInfo, instrumentIndex) => {
            this._instrumentPlayerArrays[instrumentIndex] = [];
            this._instrumentPlayerNoteArrays[instrumentIndex] = [];
            instrumentInfo.samples.forEach((sample, noteIndex) => {
                const filePath = `instruments/${instrumentInfo.dirName}/${sample}`;
                const promise = this._storeSound(filePath, noteIndex, this._instrumentPlayerArrays[instrumentIndex]);
                loadingPromises.push(promise);
            });
        });
        Promise.all(loadingPromises).then(() => {
            // @TODO: Update the extension status indicator.
        });
    }

    /**
     * Decode a sound and store the player in an array.
     * @param {string} filePath - the audio file name.
     * @param {number} index - the index at which to store the audio player.
     * @param {array} playerArray - the array of players in which to store it.
     * @return {Promise} - a promise which will resolve once the sound has been stored.
     */
    _storeSound (filePath, index, playerArray) {
        const fullPath = `${filePath}.mp3`;

        if (!assetData[fullPath]) return;

        // The sound player has already been downloaded via the manifest file required above.
        const soundBuffer = assetData[fullPath];

        return this._decodeSound(soundBuffer).then(player => {
            playerArray[index] = player;
        });
    }

    /**
     * Decode a sound and return a promise with the audio buffer.
     * @param  {ArrayBuffer} soundBuffer - a buffer containing the encoded audio.
     * @return {Promise} - a promise which will resolve once the sound has decoded.
     */
    _decodeSound (soundBuffer) {
        const engine = this.runtime.audioEngine;

        if (!engine) {
            return Promise.reject(new Error('No Audio Context Detected'));
        }

        // Check for newer promise-based API
        return engine.decodeSoundPlayer({data: {buffer: soundBuffer}});
    }

    /**
     * Create data for a menu in scratch-blocks format, consisting of an array of objects with text and
     * value properties. The text is a translated string, and the value is one-indexed.
     * @param  {object[]} info - An array of info objects each having a name property.
     * @return {array} - An array of objects with text and value properties.
     * @private
     */
    _buildMenu (info) {
        return info.map((entry, index) => {
            const obj = {};
            obj.text = entry.name;
            obj.value = String(index + 1);
            return obj;
        });
    }

    /**
     * The key to load & store a target's music-related state.
     * @type {string}
     */
    static get STATE_KEY () {
        return 'Scratch.musiccreation';
    }

    /**
     * The default music-related state, to be used when a target has no existing music state.
     * @type {MusicState}
     */
    static get DEFAULT_MUSIC_STATE () {
        return {
            currentInstrument: 0
        };
    }

    /**
     * The minimum and maximum MIDI note numbers, for clamping the input to play note.
     * @type {{min: number, max: number}}
     */
    static get MIDI_NOTE_RANGE () {
        return {min: 0, max: 130};
    }

    /**
     * The minimum and maximum beat values, for clamping the duration of play note, play drum and rest.
     * 100 beats at the default tempo of 60bpm is 100 seconds.
     * @type {{min: number, max: number}}
     */
    static get BEAT_RANGE () {
        return {min: 0, max: 100};
    }

    /**
     * The maximum number of sounds to allow to play simultaneously.
     * @type {number}
     */
    static get CONCURRENCY_LIMIT () {
        return 30;
    }

    /**
     * @param {Target} target - collect music state for this target.
     * @returns {MusicState} the mutable music state associated with that target. This will be created if necessary.
     * @private
     */
    _getMusicState (target) {
        let musicState = target.getCustomState(Scratch3MusicCreation.STATE_KEY);
        if (!musicState) {
            musicState = Clone.simple(Scratch3MusicCreation.DEFAULT_MUSIC_STATE);
            target.setCustomState(Scratch3MusicCreation.STATE_KEY, musicState);
        }
        return musicState;
    }


    /**
     * An array of info about each instrument.
     * @type {object[]}
     * @param {string} name - the translatable name to display in the instruments menu.
     * @param {string} dirName - the name of the directory containing audio samples for this instrument.
     * @param {number} [releaseTime] - an optional duration for the release portion of each note.
     * @param {number[]} samples - an array of numbers representing the MIDI note number for each
     *                           sampled sound used to play this instrument.
     */
    get INSTRUMENT_INFO () {
        return [
            {
                name: formatMessage({
                    id: 'musiccreation.instrumentPiano',
                    default: 'Piano',
                    description: 'Sound of a piano'
                }),
                dirName: '1-piano',
                releaseTime: 0.5,
                samples: [24, 36, 48, 60, 72, 84, 96, 108]
            },
            {
                name: formatMessage({
                    id: 'musiccreation.instrumentGuitar',
                    default: 'Guitar',
                    description: 'Sound of an accoustic guitar'
                }),
                dirName: '4-guitar',
                releaseTime: 0.5,
                samples: [60]
            },            {
                name: formatMessage({
                    id: 'music.instrumentBass',
                    default: 'Bass',
                    description: 'Sound of an accoustic upright bass'
                }),
                dirName: '6-bass',
                releaseTime: 0.25,
                samples: [36, 48]
            },
            {
                name: formatMessage({
                    id: 'musiccreation.instrumentCello',
                    default: 'Cello',
                    description: 'Sound of a cello being played with a bow'
                }),
                dirName: '8-cello',
                releaseTime: 0.1,
                samples: [36, 48, 60]
            },
            {
                name: formatMessage({
                    id: 'musiccreation.instrumentSaxophone',
                    default: 'Saxophone',
                    description: 'Sound of a saxophone being played'
                }),
                dirName: '11-saxophone',
                samples: [36, 60, 84]
            },
            {
                name: formatMessage({
                    id: 'music.instrumentClarinet',
                    default: 'Clarinet',
                    description: 'Sound of a clarinet being played'
                }),
                dirName: '10-clarinet',
                samples: [48, 60]
            },
            {
                name: formatMessage({
                    id: 'musiccreation.instrumentSynthLead',
                    default: 'Synth',
                    description: 'Sound of a "lead" synthesizer being played'
                }),
                dirName: '20-synth-lead',
                releaseTime: 0.1,
                samples: [60]
            }
        ];
    }


    getInfo () {
        return {
            id: 'musiccreation',
            name: 'Music Creation',
            blocks: [
                {
                    opcode: 'setInstrument',
                    blockType: BlockType.COMMAND,
                    text: 'set instrument to [INSTRUMENT]',
                    arguments: {
                        INSTRUMENT: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 1,
                            menu: "INSTRUMENT"
                        }
                    }
                },
                {
                    opcode: 'setVolume',
                    blockType: BlockType.COMMAND,
                    text: 'set volume to [VOLUME]',
                    arguments: {
                        VOLUME: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 60,
                            menu: "volumes"
                        }
                    }
                },
                {
                    opcode: 'playNote',
                    blockType: BlockType.COMMAND,
                    text: 'play note with frequency [NOTE] for [SECS] seconds',
                    arguments: {
                        NOTE: {
                            type: ArgumentType.NOTE,
                            defaultValue: 60
                        },
                        SECS: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 0.25
                        }
                    }
                },
                {
                    opcode: 'recordNotes',
                    blockType: BlockType.COMMAND,
                    text: 'record notes with frequency [NOTE] for [SECS] seconds',
                    arguments: {
                        NOTE: {
                            type: ArgumentType.NOTE,
                            defaultValue: 60
                        },
                        SECS: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 0.25
                        }
                    }
                },
                {
                    opcode: 'saveFile',
                    blockType: BlockType.COMMAND,
                    text: 'save file to [FILENAME].wav',
                    arguments: {
                        FILENAME: {
                            type: ArgumentType.STRING,
                            defaultValue: "myMusic"
                        }
                    }
                },
                {
                    opcode: 'getVolume',
                    text: formatMessage({
                        id: 'musiccreation.getVolume',
                        default: 'volume',
                        description: 'get the current volume'
                    }),
                    blockType: BlockType.REPORTER
                },
                {
                    opcode: 'getInstrument',
                    text: formatMessage({
                        id: 'musiccreation.getInstrument',
                        default: 'instrument',
                        description: 'get the current instrument'
                    }),
                    blockType: BlockType.REPORTER
                },
                {
                    opcode: 'testMagentaPlayer',
                    text: formatMessage({
                        id: 'musiccreation.testMagentaPlayer',
                        default: 'test Magenta player',
                        description: 'test Magenta'
                    }),
                    blockType: BlockType.COMMAND
                },
                {
                    opcode: 'testMagentaRNN',
                    text: formatMessage({
                        id: 'musiccreation.testMagentaRNN',
                        default: 'test Magenta RNN',
                        description: 'test Magenta RNN'
                    }),
                    blockType: BlockType.COMMAND
                },
                {
                    opcode: 'testMagentaMVAE',
                    text: formatMessage({
                        id: 'musiccreation.testMagentaMVAE',
                        default: 'test Magenta MVAE',
                        description: 'test Magenta MVAE'
                    }),
                    blockType: BlockType.COMMAND
                }
            ],
            menus: {
                volumes: {
                    acceptReporters: true,
                    items: [
                        {text: "pianissimo", value: 15}, 
                        {text: "piano", value: 30}, 
                        {text: "mezzo-piano", value: 45},
                        {text: "mezzo-forte", value: 60},
                        {text: "forte", value: 85},
                        {text: "fortissimo", value: 100}]
                },
                INSTRUMENT: {
                    acceptReporters: true,
                    items: this._buildMenu(this.INSTRUMENT_INFO)
                }
            }
        };
    }

    findInstrumentForNumber (number) {
        for (var m in instrumentNames) {
            if (instrumentNames[m].value == number) {
                return instrumentNames[m].text;
            }
        } 
        return "Piano";
    }

    /**
     * Select an instrument for playing notes.
     * @param {object} args - the block arguments.
     * @param {object} util - utility object provided by the runtime.
     * @property {int} INSTRUMENT - the number of the instrument to select.
     */
    setInstrument (args, util) {
        this._setInstrument(args.INSTRUMENT, util, false);
    }

    testMagentaPlayer (util) {
        TWINKLE_TWINKLE = {
		  notes: [
		    {pitch: 60, startTime: 0.0, endTime: 0.5},
		    {pitch: 60, startTime: 0.5, endTime: 1.0},
		    {pitch: 67, startTime: 1.0, endTime: 1.5},
		    {pitch: 67, startTime: 1.5, endTime: 2.0},
		    {pitch: 69, startTime: 2.0, endTime: 2.5},
		    {pitch: 69, startTime: 2.5, endTime: 3.0},
		    {pitch: 67, startTime: 3.0, endTime: 4.0},
		    {pitch: 65, startTime: 4.0, endTime: 4.5},
		    {pitch: 65, startTime: 4.5, endTime: 5.0},
		    {pitch: 64, startTime: 5.0, endTime: 5.5},
		    {pitch: 64, startTime: 5.5, endTime: 6.0},
		    {pitch: 62, startTime: 6.0, endTime: 6.5},
		    {pitch: 62, startTime: 6.5, endTime: 7.0},
		    {pitch: 60, startTime: 7.0, endTime: 8.0},  
		  ],
		  totalTime: 8
		};
		const player = new core.SoundFontPlayer('https://storage.googleapis.com/magentadata/js/soundfonts/sgm_plus');
		player.start(TWINKLE_TWINKLE);
		player.stop();
		log.log(TWINKLE_TWINKLE);
    }

    testMagentaRNN (utils) {
        TWINKLE_TWINKLE = {
          notes: [
            {pitch: 60, startTime: 0.0, endTime: 0.5},
            {pitch: 60, startTime: 0.5, endTime: 1.0},
            {pitch: 67, startTime: 1.0, endTime: 1.5},
            {pitch: 67, startTime: 1.5, endTime: 2.0},
            {pitch: 69, startTime: 2.0, endTime: 2.5},
            {pitch: 69, startTime: 2.5, endTime: 3.0},
            {pitch: 67, startTime: 3.0, endTime: 4.0},
            {pitch: 65, startTime: 4.0, endTime: 4.5},
            {pitch: 65, startTime: 4.5, endTime: 5.0},
            {pitch: 64, startTime: 5.0, endTime: 5.5},
            {pitch: 64, startTime: 5.5, endTime: 6.0},
            {pitch: 62, startTime: 6.0, endTime: 6.5},
            {pitch: 62, startTime: 6.5, endTime: 7.0},
            {pitch: 60, startTime: 7.0, endTime: 8.0},  
          ],
          totalTime: 8
        };
        const player = new core.SoundFontPlayer('https://storage.googleapis.com/magentadata/js/soundfonts/sgm_plus');
        if (player.isPlaying()) {
            player.stop();
            return;
        }
        music_rnn = new rnn.MusicRNN('https://storage.googleapis.com/magentadata/js/checkpoints/music_rnn/basic_rnn');
        music_rnn.initialize();
        rnn_steps = 20;
        rnn_temperature = 1.5;
              
        const qns = core.sequences.quantizeNoteSequence(TWINKLE_TWINKLE, 4);
        music_rnn
        .continueSequence(qns, rnn_steps, rnn_temperature)
        .then((sample) => player.start(sample));
        log.log(TWINKLE_TWINKLE);
    }

    testMagentaMVAE (utils) {
        TWINKLE_TWINKLE = {
          notes: [
            {pitch: 60, startTime: 0.0, endTime: 0.5},
            {pitch: 60, startTime: 0.5, endTime: 1.0},
            {pitch: 67, startTime: 1.0, endTime: 1.5},
            {pitch: 67, startTime: 1.5, endTime: 2.0},
            {pitch: 69, startTime: 2.0, endTime: 2.5},
            {pitch: 69, startTime: 2.5, endTime: 3.0},
            {pitch: 67, startTime: 3.0, endTime: 4.0},
            {pitch: 65, startTime: 4.0, endTime: 4.5},
            {pitch: 65, startTime: 4.5, endTime: 5.0},
            {pitch: 64, startTime: 5.0, endTime: 5.5},
            {pitch: 64, startTime: 5.5, endTime: 6.0},
            {pitch: 62, startTime: 6.0, endTime: 6.5},
            {pitch: 62, startTime: 6.5, endTime: 7.0},
            {pitch: 60, startTime: 7.0, endTime: 8.0},  
          ],
          totalTime: 8
        };
        const player = new core.SoundFontPlayer('https://storage.googleapis.com/magentadata/js/soundfonts/sgm_plus');
        if (player.isPlaying()) {
            player.stop();
            return;
        }
        music_vae = new mvae.MusicVAE('https://storage.googleapis.com/magentadata/js/checkpoints/music_vae/mel_4bar_small_q2');
        music_vae.initialize();
        vae_temperature = 1.5;

        music_vae
        .sample(1, vae_temperature)
        .then((sample) => player.start(sample[0]));
        log.log(TWINKLE_TWINKLE);
    }

    getInstrument (util) {
        const stage = this.runtime.getTargetForStage();
        if (stage) {
            if (!stage.instrument) {
                stage.instrument = "Piano";
            }
            return stage.instrument;
        }
        return 0;
    }

    /**
     * Internal code to select an instrument for playing notes. If mapMidi is true, set the instrument according to
     * the MIDI to Scratch instrument mapping.
     * @param {number} instNum - the instrument number.
     * @param {object} util - utility object provided by the runtime.
     * @param {boolean} mapMidi - whether or not instNum is a MIDI instrument number.
     */
    _setInstrument (instNum, util, mapMidi) {
        const musicState = this._getMusicState(util.target);
        instNum = Cast.toNumber(instNum);
        instNum = Math.round(instNum);
        const stage = this.runtime.getTargetForStage();
        if (stage) {
            stage.instrument = this.findInstrumentForNumber(instNum);
        }
        instNum -= 1; // instruments are one-indexed
        instNum = MathUtil.wrapClamp(instNum, 0, this.INSTRUMENT_INFO.length - 1);
        musicState.currentInstrument = instNum;
    }

    _playNoteForPicker (noteNum, category) {
        if (category !== this.getInfo().name) return;
        const util = {
            runtime: this.runtime,
            target: this.runtime.getEditingTarget()
        };
        this.noteList.push(noteNum);
        log.log(this.noteList);
        this._playNote(util, noteNum, 0.25);
    }

    _syncEffectsForTarget (target) {
        if (!target || !target.sprite.soundBank) return;
        target.soundEffects = this._getSoundState(target).effects;

        target.sprite.soundBank.setEffects(target);
    }

    findVolumeForNumber (number) {
        for (var m in volumes) {
            if (volumes[m].value == number) {
                return volumes[m].text;
            }
        } 
        return "mezzo-forte";
    }

    /**
     * Set the current tempo to a new value.
     * @param {object} args - the block arguments.
     * @property {number} TEMPO - the tempo, in beats per minute.
     */
    setVolume (args, util) {
        const volume = Cast.toNumber(args.VOLUME);
        this._updateVolume(volume, util);
    }


    /**
     * Update the current tempo, clamping it to the min and max allowable range.
     * @param {number} tempo - the tempo to set, in beats per minute.
     * @private
     */
    _updateVolume (volume, util) {
        volume = MathUtil.clamp(volume, 0, 100);
        util.target.volume = volume;
        const stage = this.runtime.getTargetForStage();
        if (stage) {
            stage.volume = this.findVolumeForNumber(volume);
        }
    }

    getVolume () {
        const stage = this.runtime.getTargetForStage();
        if (stage) {
            if (stage.volume == 100) {
                stage.volume = "fortissimo";
            }
            return stage.volume;
        }
        return "mezzo-forte";
    }

    recordNotes (args, util) {
    	for (var n in this.nodeList) {
    		this.playNote(args, util);
    	}
    	/*
    	if (this._stackTimerNeedsInit(util)) {
        	for (var n in this.noteList) {
        		note = this.noteList[n];
        		log.log(note);
	            let note = Cast.toNumber(note);
	            log.log(note);
	            note = MathUtil.clamp(note,
	                Scratch3MusicCreation.MIDI_NOTE_RANGE.min, Scratch3MusicCreation.MIDI_NOTE_RANGE.max);
	            log.log(note);
	            let beats = Cast.toNumber(args.SECS);
	            beats = this._clampBeats(beats);
	            // If the duration is 0, do not play the note. In Scratch 2.0, "play drum for 0 beats" plays the drum,
	            // but "play note for 0 beats" is silent.
	            if (beats === 0) return;

	            const durationSec = beats;

	            this._playNote(util, note, durationSec);

	            this._startStackTimer(util, durationSec);
	        }
	    } else {
	            this._checkStackTimer(util);
	    }
	    */
    }

    playNote (args, util) {
    	log.log("here");
        if (this._stackTimerNeedsInit(util)) {
            let note = Cast.toNumber(args.NOTE);
            log.log(args.NOTE);
            note = MathUtil.clamp(note,
                Scratch3MusicCreation.MIDI_NOTE_RANGE.min, Scratch3MusicCreation.MIDI_NOTE_RANGE.max);
            let beats = Cast.toNumber(args.SECS);
            beats = this._clampBeats(beats);
            // If the duration is 0, do not play the note. In Scratch 2.0, "play drum for 0 beats" plays the drum,
            // but "play note for 0 beats" is silent.
            if (beats === 0) return;

            const durationSec = beats;

            this._playNote(util, note, durationSec);

            this._startStackTimer(util, durationSec);
        } else {
            this._checkStackTimer(util);
        }
    }

    /**
     * Play a note using the current instrument for a duration in seconds.
     * This function actually plays the sound, and handles the timing of the sound, including the
     * "release" portion of the sound, which continues briefly after the block execution has finished.
     * @param {object} util - utility object provided by the runtime.
     * @param {number} note - the pitch of the note to play, interpreted as a MIDI note number.
     * @param {number} durationSec - the duration in seconds to play the note.
     * @private
     */
    _playNote (util, note, durationSec) {
        if (util.runtime.audioEngine === null) return;
        if (util.target.sprite.soundBank === null) return;

        // If we're playing too many sounds, do not play the note.
        if (this._concurrencyCounter > Scratch3MusicCreation.CONCURRENCY_LIMIT) {
            return;
        }

        // Determine which of the audio samples for this instrument to play
        const musicState = this._getMusicState(util.target);
        const inst = musicState.currentInstrument;
        const instrumentInfo = this.INSTRUMENT_INFO[inst];
        const sampleArray = instrumentInfo.samples;
        const sampleIndex = this._selectSampleIndexForNote(note, sampleArray);

        // If the audio sample has not loaded yet, bail out
        if (typeof this._instrumentPlayerArrays[inst] === 'undefined') return;
        if (typeof this._instrumentPlayerArrays[inst][sampleIndex] === 'undefined') return;

        // Fetch the sound player to play the note.
        const engine = util.runtime.audioEngine;

        if (!this._instrumentPlayerNoteArrays[inst][note]) {
            this._instrumentPlayerNoteArrays[inst][note] = this._instrumentPlayerArrays[inst][sampleIndex].take();
        }

        const player = this._instrumentPlayerNoteArrays[inst][note];

        if (player.isPlaying && !player.isStarting) {
            // Take the internal player state and create a new player with it.
            // `.play` does this internally but then instructs the sound to
            // stop.
            player.take();
        }

        // Set its pitch.
        const sampleNote = sampleArray[sampleIndex];
        const notePitchInterval = this._ratioForPitchInterval(note - sampleNote);

        // Create gain nodes for this note's volume and release, and chain them
        // to the output.
        const context = engine.audioContext;
        const volumeGain = context.createGain();
        volumeGain.gain.setValueAtTime(util.target.volume / 100, engine.currentTime);
        const releaseGain = context.createGain();
        volumeGain.connect(releaseGain);
        releaseGain.connect(engine.getInputNode());

        // Schedule the release of the note, ramping its gain down to zero,
        // and then stopping the sound.
        let releaseDuration = this.INSTRUMENT_INFO[inst].releaseTime;
        if (typeof releaseDuration === 'undefined') {
            releaseDuration = 0.01;
        }
        const releaseStart = context.currentTime + durationSec;
        const releaseEnd = releaseStart + releaseDuration;
        releaseGain.gain.setValueAtTime(1, releaseStart);
        releaseGain.gain.linearRampToValueAtTime(0.0001, releaseEnd);

        this._concurrencyCounter++;
        player.once('stop', () => {
            this._concurrencyCounter--;
        });

        // Start playing the note
        player.play();
        // Connect the player to the gain node.
        player.connect({getInputNode () {
            return volumeGain;
        }});
        // Set playback now after play creates the outputNode.
        player.outputNode.playbackRate.value = notePitchInterval;
        // Schedule playback to stop.
        player.outputNode.stop(releaseEnd);
    }

    /**
     * The samples array for each instrument is the set of pitches of the available audio samples.
     * This function selects the best one to use to play a given input note, and returns its index
     * in the samples array.
     * @param  {number} note - the input note to select a sample for.
     * @param  {number[]} samples - an array of the pitches of the available samples.
     * @return {index} the index of the selected sample in the samples array.
     * @private
     */
    _selectSampleIndexForNote (note, samples) {
        // Step backwards through the array of samples, i.e. in descending pitch, in order to find
        // the sample that is the closest one below (or matching) the pitch of the input note.
        for (let i = samples.length - 1; i >= 0; i--) {
            if (note >= samples[i]) {
                return i;
            }
        }
        return 0;
    }

    /**
     * Calcuate the frequency ratio for a given musical interval.
     * @param  {number} interval - the pitch interval to convert.
     * @return {number} a ratio corresponding to the input interval.
     * @private
     */
    _ratioForPitchInterval (interval) {
        return Math.pow(2, (interval / 12));
    }

    saveFile (args) {
        const text = Cast.toString(args.FILENAME);
        log.log(text);
    }

    /**
     * Start the stack timer and the yield the thread if necessary.
     * @param {object} util - utility object provided by the runtime.
     * @param {number} duration - a duration in seconds to set the timer for.
     * @private
     */
    _startStackTimer (util, duration) {
        util.stackFrame.timer = new Timer();
        util.stackFrame.timer.start();
        util.stackFrame.duration = duration;
        util.yield();
    }

    /**
     * Check if the stack timer needs initialization.
     * @param {object} util - utility object provided by the runtime.
     * @return {boolean} - true if the stack timer needs to be initialized.
     * @private
     */
    _stackTimerNeedsInit (util) {
        return !util.stackFrame.timer;
    }

    /**
     * Check the stack timer, and if its time is not up yet, yield the thread.
     * @param {object} util - utility object provided by the runtime.
     * @private
     */
    _checkStackTimer (util) {
        const timeElapsed = util.stackFrame.timer.timeElapsed();
        if (timeElapsed < util.stackFrame.duration * 1000) {
            util.yield();
        }
    }

    /**
     * Clamp a duration in beats to the allowed min and max duration.
     * @param  {number} beats - a duration in beats.
     * @return {number} - the clamped duration.
     * @private
     */
    _clampBeats (beats) {
        return MathUtil.clamp(beats, Scratch3MusicCreation.BEAT_RANGE.min, Scratch3MusicCreation.BEAT_RANGE.max);
    }


}

module.exports = Scratch3MusicCreation;