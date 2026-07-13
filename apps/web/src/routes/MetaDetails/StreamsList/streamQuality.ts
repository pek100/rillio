// Parse an addon stream's title text into quality facets, then curate the best
// pick per quality tier. Addons (Torrentio chiefly) encode resolution, HDR, size
// and seeders in the name/description strings, so this is best-effort text parsing:
// anything we can't classify falls through to the "all streams" bucket rather than
// being mis-tiered. Bitrate is not reported by addons; since every stream here is
// the SAME title (same runtime), file SIZE is a faithful proxy for bitrate, so we
// rank "highest bitrate / quality" by size within a tier.

// Streams carry more than the parser needs (the UI attaches onClick, deep links,
// etc.); the parser only reads name/description, so the rest is kept open.
type StreamLike = { name?: string | null; description?: string | null; [key: string]: any };

type Quality = {
    resolution: number | null;
    hdr: boolean;
    size: number | null;
    seeders: number | null;
    flags: string[];
    langs: Set<string>;
};

type WithQuality = { stream: StreamLike; quality: Quality };

type Tier = { key: string; label: string; match: (q: Quality) => boolean };

type Pick = { tierKey: string; label: string; entry: WithQuality };

type Curated = { picks: Pick[]; rest: WithQuality[] };

type Recommendation = { entry: WithQuality; label: string; tierKey: string; pickIndex: number };

type Screen = { hdr?: boolean; resolutionHeight: number };

const SIZE_UNITS: Record<string, number> = { tb: 1099511627776, tib: 1099511627776, gb: 1073741824, gib: 1073741824, mb: 1048576, mib: 1048576 };

// Human-readable size for a byte count (the display counterpart of parseSize).
const formatSize = (bytes: number | null | undefined): string | null => {
    if (!bytes) return null;
    const gb = bytes / SIZE_UNITS.gb;
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    return `${Math.round(bytes / SIZE_UNITS.mb)} MB`;
};

const parseSize = (text: string): number | null => {
    const m = /([\d.]+)\s*(tib|tb|gib|gb|mib|mb)/i.exec(text);
    if (!m) return null;
    const n = parseFloat(m[1]);
    const unit = SIZE_UNITS[m[2].toLowerCase()];
    return (isNaN(n) || !unit) ? null : Math.round(n * unit);
};

const parseSeeders = (text: string): number | null => {
    // Torrentio: "👤 16". Others: "Seeders: 16" / "16 seeds".
    const m = /👤\s*(\d+)/.exec(text) || /(?:seeders?|seeds)\D{0,3}(\d+)/i.exec(text) || /(\d+)\s*(?:seeders?|seeds)/i.exec(text);
    return m ? parseInt(m[1], 10) : null;
};

const parseResolution = (text: string): number | null => {
    if (/\b(4k|2160p?|uhd)\b/i.test(text)) return 2160;
    if (/\b1440p?\b/i.test(text)) return 1440;
    if (/\b1080p?\b|\bfhd\b/i.test(text)) return 1080;
    if (/\b720p?\b|\bhd\b/i.test(text)) return 720;
    if (/\b480p?\b|\bsd\b/i.test(text)) return 480;
    return null;
};

const parseHdr = (text: string): boolean => /\b(hdr10\+?|hdr|dolby\s*vision|dovi|\bdv\b)\b/i.test(text);

// Country (from a flag emoji) -> ISO 639-2 language code. Torrentio marks audio
// languages with country flags; this maps the common ones. Unmapped flags are
// still shown, they just don't participate in language matching.
const COUNTRY_LANG: Record<string, string> = {
    GB: 'eng', US: 'eng', AU: 'eng', CA: 'eng', IE: 'eng', NZ: 'eng',
    IT: 'ita', FR: 'fra', DE: 'deu', AT: 'deu', ES: 'spa', MX: 'spa', AR: 'spa',
    PT: 'por', BR: 'por', RU: 'rus', JP: 'jpn', KR: 'kor', CN: 'zho', TW: 'zho',
    IL: 'heb', NL: 'nld', PL: 'pol', SE: 'swe', NO: 'nor', DK: 'dan', FI: 'fin',
    GR: 'ell', TR: 'tur', SA: 'ara', AE: 'ara', EG: 'ara', IN: 'hin', TH: 'tha',
    VN: 'vie', CZ: 'ces', HU: 'hun', RO: 'ron', UA: 'ukr', ID: 'ind', RS: 'srp',
    HR: 'hrv', BG: 'bul', SK: 'slk',
};

// Extract flag emojis (pairs of regional-indicator symbols) + their languages.
const parseLanguages = (text: string): { flags: string[]; langs: Set<string> } => {
    const flags: string[] = [];
    const langs = new Set<string>();
    const re = /[\u{1F1E6}-\u{1F1FF}]{2}/gu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const flag = m[0];
        if (!flags.includes(flag)) flags.push(flag);
        const country = String.fromCharCode(flag.codePointAt(0)! - 0x1F1E6 + 65, flag.codePointAt(2)! - 0x1F1E6 + 65);
        if (COUNTRY_LANG[country]) langs.add(COUNTRY_LANG[country]);
    }
    if (/\bmulti\b/i.test(text)) langs.add('multi');
    return { flags, langs };
};

// Returns { resolution, hdr, size, seeders, flags, langs } for one stream.
const parseStream = (stream: StreamLike): Quality => {
    const text = `${stream.name || ''} ${stream.description || ''}`;
    const { flags, langs } = parseLanguages(text);
    return {
        resolution: parseResolution(text),
        hdr: parseHdr(text),
        size: parseSize(text),
        seeders: parseSeeders(text),
        flags,
        langs,
    };
};

// Language preference score for a stream. Explicit match (or MULTi) beats all;
// releases with NO language markers are assumed English (Torrentio only flags
// non-English/multi audio), so they half-match when English is wanted; a stream
// explicitly marked as OTHER languages ranks last.
const langScore = (quality: Quality, lang: string | null | undefined): number => {
    if (!lang) return 1;
    if (quality.langs.has(lang) || quality.langs.has('multi')) return 2;
    if (quality.langs.size === 0) return lang === 'eng' ? 2 : 1;
    return 0;
};

// The four quality tiers, most-capable first. `match` is exclusive so a 4K HDR
// stream only ever fills the 4K HDR tier (not the SDR 4K one).
const TIERS: Tier[] = [
    { key: '4k-hdr', label: '4K HDR', match: (q) => (q.resolution ?? 0) >= 2160 && q.hdr },
    { key: '1080-hdr', label: '1080p HDR', match: (q) => q.resolution === 1080 && q.hdr },
    { key: '4k', label: '4K', match: (q) => (q.resolution ?? 0) >= 2160 && !q.hdr },
    { key: '1080', label: '1080p', match: (q) => q.resolution === 1080 && !q.hdr },
];

const bySizeDesc = (a: WithQuality, b: WithQuality): number => (b.quality.size || 0) - (a.quality.size || 0);
const bySeedersDesc = (a: WithQuality, b: WithQuality): number => (b.quality.seeders || 0) - (a.quality.seeders || 0);

// Curate in two passes. Pass 1: the best stream of each tier IN the wanted
// language (explicit flag or MULTi; unmarked releases count as English). Pass 2:
// the best stream of each tier regardless of language. Language picks lead,
// overall picks follow, deduplicated (when the language pick IS the overall best,
// it appears once). Returns { picks, rest }.
// If nothing matches any tier at all, the single best-available stream becomes
// the one pick so the user always has a curated option.
const curateStreams = (streams: StreamLike[], lang: string | null | undefined): Curated => {
    const withQuality: WithQuality[] = streams.map((stream) => ({ stream, quality: parseStream(stream) }));
    const byLangThenSize = (a: WithQuality, b: WithQuality) => (langScore(b.quality, lang) - langScore(a.quality, lang)) || bySizeDesc(a, b);
    const used = new Set<StreamLike>();
    const picks: Pick[] = [];

    // Pass 1 - wanted language, per tier.
    for (const tier of TIERS) {
        const candidates = withQuality
            .filter((s) => !used.has(s.stream) && tier.match(s.quality) && langScore(s.quality, lang) === 2)
            .sort(bySizeDesc);
        if (candidates.length) {
            used.add(candidates[0].stream);
            picks.push({ tierKey: `${tier.key}-lang`, label: tier.label, entry: candidates[0] });
        }
    }

    // Pass 2 - the overall best per tier (computed over ALL candidates, so it is
    // genuinely the top stream regardless of language); skipped when it already
    // appears as a language pick (dedup).
    for (const tier of TIERS) {
        const candidates = withQuality.filter((s) => tier.match(s.quality)).sort(bySizeDesc);
        if (candidates.length && !used.has(candidates[0].stream)) {
            used.add(candidates[0].stream);
            picks.push({ tierKey: tier.key, label: tier.label, entry: candidates[0] });
        }
    }

    if (picks.length === 0 && withQuality.length) {
        const best = withQuality.slice().sort((a, b) => byLangThenSize(a, b) || bySeedersDesc(a, b))[0];
        used.add(best.stream);
        picks.push({ tierKey: 'best', label: 'Best available', entry: best });
    }

    // The expanded list also leads with the wanted language.
    const rest = withQuality.filter((s) => !used.has(s.stream)).sort(byLangThenSize);
    return { picks, rest };
};

// Choose what a preset recommends (highlighted + what "Watch" plays).
//   quality: the highest tier present (picks are tier-ordered), pure quality.
//   speed:   the most-seeded stream of the WHOLE list (picks + rest), pure speed,
//            deliberately ignoring quality; ties broken by smaller file (lighter
//            downloads start faster).
//   auto:    the tier the screen can show; if the exact tier is absent, take the
//            highest-quality pick (at or above the screen downscales cleanly).
// Returns { entry, label, tierKey, pickIndex } where pickIndex is the index into
// picks when the recommendation is one of them, or -1 (speed can recommend a
// stream outside the curated picks).
const recommendStream = ({ picks, rest }: Curated, preset: string, screen: Screen | null | undefined, lang: string | null | undefined): Recommendation | null => {
    if (!picks.length && !rest.length) return null;

    if (preset === 'speed') {
        // Fastest within the wanted language when possible; pure seeders otherwise.
        const all = picks.map((p) => p.entry).concat(rest);
        const withLang = lang ? all.filter((e) => langScore(e.quality, lang) === 2) : all;
        const pool = withLang.length ? withLang : all;
        let best = pool[0];
        for (const entry of pool) {
            const a = entry.quality.seeders || 0, b = best.quality.seeders || 0;
            if (a > b || (a === b && (entry.quality.size || Infinity) < (best.quality.size || Infinity))) best = entry;
        }
        const pickIndex = picks.findIndex((p) => p.entry === best);
        return { entry: best, label: 'Fastest', tierKey: 'fastest', pickIndex };
    }

    if (!picks.length) return null;

    // The chosen language outranks EVERYTHING: every preset recommends within
    // the language-matching picks when any exist, and only falls back to the
    // full pick list when the language simply is not available.
    const langPicks = lang ? picks.filter((p) => langScore(p.entry.quality, lang) === 2) : picks;
    const pool = langPicks.length ? langPicks : picks;

    if (preset === 'auto' && screen) {
        const wantHdr = !!screen.hdr;
        const wantRes = screen.resolutionHeight >= 2160 ? 2160 : 1080;
        const ideal = pool.find((p) => {
            const q = p.entry.quality;
            const res = (q.resolution ?? 0) >= 2160 ? 2160 : (q.resolution === 1080 ? 1080 : q.resolution);
            return res === wantRes && !!q.hdr === wantHdr;
        });
        const chosen = ideal || pool[0];
        return { entry: chosen.entry, label: chosen.label, tierKey: chosen.tierKey, pickIndex: picks.indexOf(chosen) };
    }

    // quality (default): the pool is tier-ordered, so its head is the highest
    // tier available in the chosen language.
    return { entry: pool[0].entry, label: pool[0].label, tierKey: pool[0].tierKey, pickIndex: picks.indexOf(pool[0]) };
};

// Representative flag emoji for a language code (first country that maps to it).
const flagFor = (lang: string): string | null => {
    for (const country of Object.keys(COUNTRY_LANG)) {
        if (COUNTRY_LANG[country] === lang) {
            return String.fromCodePoint(0x1F1E6 + country.charCodeAt(0) - 65, 0x1F1E6 + country.charCodeAt(1) - 65);
        }
    }
    return null;
};

// Every language that appears (explicitly) across the given streams.
const availableLanguages = (streams: StreamLike[]): string[] => {
    const out = new Set<string>();
    for (const stream of streams) {
        const { langs } = parseLanguages(`${stream.name || ''} ${stream.description || ''}`);
        langs.forEach((l) => { if (l !== 'multi') out.add(l); });
    }
    return [...out];
};

export { parseStream, curateStreams, recommendStream, flagFor, availableLanguages, formatSize, TIERS };
