// Copyright (C) 2017-2026 Smart code 203358507

/**
 * Smart audio/subtitle track scoring (design after Stremio-Kai's smart track
 * selector, reimplemented from scratch).
 *
 * The old selection was "first track whose language matches", which picks
 * whatever the muxer listed first: for anime that is routinely the
 * "Signs & Songs" subtitle track instead of full dialogue, and a forced track
 * (partial subs for foreign lines/on-screen text) beats the real one whenever
 * it is listed earlier. Audio had no defence against commentary tracks.
 *
 * Scoring instead of find-first:
 *   - language match is required (no match -> null, never a wrong-language pick),
 *   - reject-keyword tracks (signs/songs/commentary/karaoke...) never win,
 *   - forced tracks never win normal selection (they are not full subtitles),
 *   - full-dialogue keywords and the container's default flag break ties.
 *
 * Pure functions over the bridge's track shape; the callers own WHEN to select
 * (saved-track priority, one-shot guards) exactly as before.
 */

import { languages } from 'rillio/common';

export type ScorableTrack = {
    id: string;
    lang?: string;
    label?: string;
    forced?: boolean;
    default?: boolean;
};

// Subtitle tracks that are not full dialogue. "signs"/"songs" are the anime
// typesetting tracks; the rest are alternates nobody means by "subtitles on".
const SUB_REJECT = [/\bsigns?\b/i, /\bsongs?\b/i, /\bcommentary\b/i, /\bkaraoke\b/i, /\bforced\b/i];
// Markers of the track everyone means: the complete dialogue subtitle.
const SUB_PREFER = [/\bfull\b/i, /\bdialogue\b/i, /\bcomplete\b/i];
// Audio tracks that are never the movie itself.
const AUDIO_REJECT = [/\bcommentary\b/i, /\bdescri(ptive|ption)\b/i, /\baudio description\b/i];

const matchesAny = (text: string, patterns: RegExp[]): boolean =>
    patterns.some((pattern) => pattern.test(text));

// Track languages arrive as whatever the muxer wrote ('en', 'eng', 'English');
// settings speak ISO 639-2. Normalize both sides through the languages module,
// falling back to a raw case-insensitive comparison for tags it cannot resolve.
export const langMatches = (trackLang: string | undefined, wanted: string | null): boolean => {
    if (typeof trackLang !== 'string' || trackLang.length === 0 || wanted === null) return false;
    if (trackLang.toLowerCase() === wanted.toLowerCase()) return true;
    return languages.toCode(trackLang) === languages.toCode(wanted);
};

const scoreSubtitlesTrack = (track: ScorableTrack, wantedLang: string | null): number => {
    if (!langMatches(track.lang, wantedLang)) return -1;
    const label = track.label ?? '';
    if (track.forced === true || matchesAny(label, SUB_REJECT)) return -1;
    let score = 100;
    if (matchesAny(label, SUB_PREFER)) score += 20;
    if (track.default === true) score += 10;
    return score;
};

const scoreAudioTrack = (track: ScorableTrack, wantedLang: string | null): number => {
    if (!langMatches(track.lang, wantedLang)) return -1;
    if (matchesAny(track.label ?? '', AUDIO_REJECT)) return -1;
    let score = 100;
    if (track.default === true) score += 10;
    return score;
};

const best = <T extends ScorableTrack>(tracks: T[], score: (track: T) => number): T | null => {
    let winner: T | null = null;
    let winnerScore = 0;
    for (const track of tracks) {
        const trackScore = score(track);
        // Strictly greater: ties keep the EARLIER track, preserving the
        // container's ordering as the final tiebreak (it usually lists the
        // canonical track first among equals).
        if (trackScore > winnerScore) {
            winner = track;
            winnerScore = trackScore;
        }
    }
    return winner;
};

/** The best full-dialogue subtitle track in the wanted language, or null. */
export const pickSubtitlesTrack = <T extends ScorableTrack>(tracks: T[], wantedLang: string | null): T | null =>
    best(tracks, (track) => scoreSubtitlesTrack(track, wantedLang));

/** The best real (non-commentary) audio track in the wanted language, or null. */
export const pickAudioTrack = <T extends ScorableTrack>(tracks: T[], wantedLang: string | null): T | null =>
    best(tracks, (track) => scoreAudioTrack(track, wantedLang));
