Put your song here, e.g. my-song.mp3 or my-song.ogg

Then point the chart at it:

    "song": { "audio": "assets/audio/my-song.mp3" }

MP3, OGG, WAV and M4A all work. OGG is the smallest for a given quality;
MP3 has the widest support. If you want both, load the one the browser
prefers:

    const canOgg = new Audio().canPlayType('audio/ogg; codecs="vorbis"');
    await game.conductor.loadURL(canOgg ? "assets/audio/song.ogg"
                                        : "assets/audio/song.mp3");
