/* =========================================================================
 *  DATA  (js/lobby/data.js)
 *  -------------------------------------------------------------------------
 *  The lobby's only connection to the outside world: one fetch() of
 *  game_data.json. Nothing else in the lobby modules knows or cares that
 *  the data comes from a file — swap this for a real API call later and
 *  screens.js / app.js don't change.
 *
 *  Schema (root is the array itself):
 *    [{
 *      id, name, lifespan, era, origin, portraitUrl, biography,
 *      songs: [{ id, title, difficulty, myScore, audioUrl, chartUrl }]
 *    }, …]
 * ======================================================================= */

export class GameDataError extends Error {}

/**
 * @param {string} url
 * @returns {Promise<object[]>} the composers array, validated and normalized
 */
export async function loadGameData(url = "game_data.json") {
  let res;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch (err) {
    throw new GameDataError(`Couldn't reach ${url} (${err.message}).`);
  }
  if (!res.ok) {
    throw new GameDataError(`${url} responded with ${res.status} ${res.statusText}.`);
  }

  let raw;
  try {
    raw = await res.json();
  } catch (err) {
    throw new GameDataError(`${url} isn't valid JSON (${err.message}).`);
  }

  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.composers) ? raw.composers : null;
  if (!list) {
    throw new GameDataError(`${url} should be an array of composers.`);
  }
  if (!list.length) {
    throw new GameDataError(`${url} has no composers in it yet.`);
  }

  return list.map(normalizeComposer);
}

const DIFFICULTIES = ["EASY", "NORMAL", "HARD", "MASTER"];

function normalizeComposer(c, i) {
  if (!c || typeof c !== "object") throw new GameDataError(`composers[${i}] isn't an object.`);
  if (!c.id) throw new GameDataError(`composers[${i}] is missing an "id".`);
  return {
    id: String(c.id),
    name: c.name || "Unknown composer",
    lifespan: c.lifespan || "",
    era: c.era || "",
    origin: c.origin || "",
    portraitUrl: c.portraitUrl || "",
    biography: c.biography || "No biography has been written for this composer yet.",
    songs: Array.isArray(c.songs) ? c.songs.map((s, j) => normalizeSong(s, i, j)) : [],
  };
}

function normalizeSong(s, ci, si) {
  if (!s || typeof s !== "object") throw new GameDataError(`composers[${ci}].songs[${si}] isn't an object.`);
  if (!s.id) throw new GameDataError(`composers[${ci}].songs[${si}] is missing an "id".`);
  const difficulty = String(s.difficulty || "NORMAL").toUpperCase();
  return {
    id: String(s.id),
    title: s.title || "Untitled",
    difficulty: DIFFICULTIES.includes(difficulty) ? difficulty : "NORMAL",
    myScore: Number.isFinite(s.myScore) ? s.myScore : 0,
    audioUrl: s.audioUrl || "",
    chartUrl: s.chartUrl || "",
  };
}
