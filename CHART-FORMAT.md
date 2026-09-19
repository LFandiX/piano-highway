# Chart format

A chart is one `.json` file. It holds the timing of every note; the music is a
separate audio file that the chart points at.

## Minimum viable chart

```json
{
  "song":  { "title": "My song", "audio": "assets/audio/my-song.mp3" },
  "chart": { "lanes": 6 },
  "notes": [
    { "t": 2.0, "lane": 0 },
    { "t": 2.5, "lane": 3 },
    { "t": 3.0, "lane": 5, "d": 1.5 }
  ]
}
```

Everything outside `notes` has a sensible default, so this is genuinely enough
to play.

## The three fields that matter

| Field  | Meaning                                                            |
|--------|--------------------------------------------------------------------|
| `t`    | The second in the song when the note must be struck. A decimal.      |
| `lane` | `0` is leftmost, `lanes - 1` is rightmost. With 6 lanes: S D F J K L. |
| `d`    | How long the note is held, in seconds. Leave it out for a tap.       |

### A tap

```json
{ "t": 12.75, "lane": 2 }
```

### A hold

Pressed at 12.75 s, released at 14.25 s.

```json
{ "t": 12.75, "lane": 2, "d": 1.5 }
```

### A chord

There is no chord type. Two or more notes that share the same `t` on different
lanes fall together and have to be hit together.

```json
{ "t": 12.75, "lane": 1 },
{ "t": 12.75, "lane": 4 }
```

A hold can be part of a chord, and so can two holds at once — one long note in
each hand while the other fingers tap is the most interesting thing you can
write with this format.

## Shorthand

Typing hundreds of objects gets old. An array means the same thing:

```json
[12.75, 2]          →  { "t": 12.75, "lane": 2 }
[12.75, 2, 1.5]     →  { "t": 12.75, "lane": 2, "d": 1.5 }
```

Mix both styles freely in one file. The recorder writes the array form because
it stays readable at a few hundred notes.

## Beats instead of seconds

Set `chart.bpm` and use `b` and `db`. Beat 0 is second 0.

```json
{ "b": 16,   "lane": 2 }            // beat 16
{ "b": 19.5, "lane": 4, "db": 3 }   // beat 19.5, held for 3 beats
```

Seconds and beats can sit side by side in the same file. If a note has both
`t` and `b`, `t` wins.

## Header fields

```jsonc
"song": {
  "title":  "Water Music Suite No. 2 — Alla Hornpipe",  // shown bottom-left
  "artist": "G. F. Handel",                             // shown above it
  "audio":  "assets/audio/alla-hornpipe.mp3",           // relative to index.html
  "offset": 0                                            // seconds, see below
},

"chart": {
  "difficulty":  "MASTER",   // free text, shown bottom-right
  "level":       14,         // optional number printed after it
  "charter":     "your name",
  "lanes":       6,          // 4–8
  "scrollSpeed": 1,          // starting speed multiplier
  "targetScore": 950000,     // the "Target" figure in the left panel
  "bpm":         116         // only needed for beat-based notes and snapping
}
```

Lane counts other than 6 get their own key layout:

| Lanes | Keys                    |
|-------|-------------------------|
| 4     | D F J K                 |
| 5     | D F Space J K           |
| 6     | S D F J K L             |
| 7     | S D F Space J K L       |
| 8     | A S D F J K L ;         |

## Offset

`song.offset` shifts every note against the audio, in seconds. Positive moves
the chart later.

Don't guess it. Play the chart, hit Escape, and use the ±5 ms buttons on the
pause screen until the notes land on the beat, then copy that number (divided
by 1000) into `song.offset`. Bluetooth headphones typically need 100–200 ms
more than wired ones, so it's worth keeping per-device.

## What the validator checks

The chart loader never crashes on a bad file. It lists what's wrong and refuses
to enable Play:

- a note with no numeric `t` or `b`
- a negative time
- a `lane` that isn't an integer, or is outside `0 … lanes-1`
- a negative `d`
- `b` or `db` used without `chart.bpm`
- two notes overlapping on the same lane (you can't press one key twice at once)

and warns about, but accepts:

- a hold shorter than the GOOD window (140 ms) — silently turned into a tap
- two notes on one lane less than 40 ms apart
- a `format` or `version` it doesn't recognise

Notes do not need to be in order. The loader sorts them.

## Recording instead of typing

The **Record a chart by ear** button plays your audio and turns your keypresses
into notes: a tap becomes a tap, a held key becomes a hold of exactly that
length. Set a BPM first and your timings get pulled onto the beat grid, which
is the difference between a chart that feels tight and one that feels drunk.
Backspace undoes the last note. When you stop, you get the `.json` to download
and hand-edit.

Recording gives you a rough draft in one pass. The polish happens in a text
editor afterwards.
