// The curated streams view: instead of a wall of near-identical torrent rows, a
// horizontal carousel with the single best pick per quality tier (4K HDR / 1080p
// HDR / 4K / 1080p), a small preset switch (Auto / Quality / Speed), and a small
// centered Watch button that plays the recommendation. Everything else collapses
// behind "Show all". No card chrome anywhere - transparent tiles, hover reveal.
const React = require('react');
const { default: Icon } = require('@stremio/stremio-icons/react');
const { Button } = require('rillio/components');
const { cn } = require('rillio/common/cn');
const { useCore } = require('rillio/core');
const { useProfile, languages } = require('rillio/common');
const { useScreenCapability } = require('rillio/common/useScreenCapability');
const { curateStreams, recommendStream, flagFor, availableLanguages, formatSize } = require('./streamQuality');

const PRESETS = [
    { key: 'auto', label: 'Auto' },
    { key: 'quality', label: 'Quality' },
    { key: 'speed', label: 'Speed' },
];

const badgeFor = (quality) => {
    const r = quality.resolution >= 2160 ? '4K' : quality.resolution === 1080 ? '1080p' : quality.resolution ? `${quality.resolution}p` : 'SD';
    return quality.hdr ? `${r} HDR` : r;
};

const providerOf = (stream) => {
    const m = /⚙️\s*([^\n]+)/.exec(stream.description || '');
    return m ? m[1].trim() : (stream.addonName || '');
};

const playHref = (stream) => (stream.deepLinks ? stream.deepLinks.player : null);

// ISO 639-2 code for the app's interface language ('en-US' -> 'eng').
const interfaceLangCode = (interfaceLanguage) =>
    languages.toCode((interfaceLanguage || 'en').split('-')[0]);

// Small pill dropdown for the wanted audio/subtitles language. Lists the
// languages actually present in the streams plus the interface language.
const LanguagePicker = ({ value, options, onSelect }) => {
    // The menu is position:fixed (anchored to the trigger's rect) because the
    // streams panel is an overflow scroll container that clips absolute children.
    const [anchor, setAnchor] = React.useState(null);
    const rootRef = React.useRef(null);
    const open = anchor !== null;

    const toggle = React.useCallback((event) => {
        if (open) { setAnchor(null); return; }
        const rect = event.currentTarget.getBoundingClientRect();
        setAnchor({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
    }, [open]);

    React.useEffect(() => {
        if (!open) return undefined;
        const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setAnchor(null); };
        const onScrollOrResize = (e) => {
            // Scrolling inside the menu itself shouldn't dismiss it.
            if (e && e.target instanceof Node && rootRef.current && rootRef.current.contains(e.target)) return;
            setAnchor(null);
        };
        document.addEventListener('pointerdown', onDown);
        window.addEventListener('resize', onScrollOrResize);
        document.addEventListener('scroll', onScrollOrResize, true);
        return () => {
            document.removeEventListener('pointerdown', onDown);
            window.removeEventListener('resize', onScrollOrResize);
            document.removeEventListener('scroll', onScrollOrResize, true);
        };
    }, [open]);

    return (
        <div ref={rootRef} className="relative">
            <Button
                className="inline-flex h-7 items-center gap-1.5 rounded-full bg-white/5 px-2.5 text-xs font-medium text-fg-muted transition hover:bg-white/10 hover:text-fg"
                title="Preferred language"
                onClick={toggle}
            >
                <span>{flagFor(value) || '🌐'}</span>
                {languages.label(value)}
                <Icon className={cn('size-3 transition-transform', open && 'rotate-180')} name="caret-down" />
            </Button>
            {open ? (
                <div
                    className="fixed z-[10000] max-h-64 min-w-40 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-elevated"
                    style={{ top: anchor.top, right: anchor.right }}
                >
                    {options.map((code) => (
                        <Button
                            key={code}
                            className={cn(
                                'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition',
                                code === value ? 'bg-accent/10 text-accent' : 'text-fg-muted hover:bg-white/5 hover:text-fg'
                            )}
                            onClick={() => { onSelect(code); setAnchor(null); }}
                        >
                            <span>{flagFor(code) || '🌐'}</span>
                            {languages.label(code)}
                        </Button>
                    ))}
                </div>
            ) : null}
        </div>
    );
};

// One carousel tile: tier label on top, provider + size + seeders under it.
// Transparent at rest; the highlighted (recommended) one gets the accent tint.
const Tile = ({ label, entry, highlighted }) => {
    const { stream, quality } = entry;
    const size = formatSize(quality.size);
    return (
        <Button
            href={playHref(stream)}
            onClick={stream.onClick}
            title={stream.description}
            className={cn(
                'group flex w-44 shrink-0 flex-col gap-1 rounded-xl px-3.5 py-3 text-left transition',
                highlighted ? 'bg-accent/10 hover:bg-accent/15' : 'hover:bg-white/5'
            )}
        >
            <div className="flex items-center gap-1.5">
                <span className={cn('text-sm font-semibold', highlighted ? 'text-accent' : 'text-fg')}>{label}</span>
                <Icon className={cn('size-3.5 transition', highlighted ? 'text-accent' : 'text-fg-subtle opacity-0 group-hover:opacity-100')} name="play" />
            </div>
            <div className="truncate text-xs text-fg-muted">{providerOf(stream) || 'Stream'}</div>
            <div className="flex items-center gap-2 text-[11px] tabular-nums text-fg-subtle">
                {size ? <span>{size}</span> : null}
                {quality.seeders != null ? <span>{quality.seeders} seed</span> : null}
                {quality.flags.length ? <span className="tracking-tight">{quality.flags.slice(0, 4).join(' ')}</span> : null}
            </div>
        </Button>
    );
};

// A compact row for the expanded "all streams" list (grid on wide screens).
const Row = ({ entry }) => {
    const { stream, quality } = entry;
    const size = formatSize(quality.size);
    return (
        <Button
            href={playHref(stream)}
            onClick={stream.onClick}
            title={stream.description}
            className="group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-white/5"
        >
            <span className="inline-flex w-16 shrink-0 justify-center rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-fg-muted">{badgeFor(quality)}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">{providerOf(stream) || stream.addonName || 'Stream'}</span>
            {quality.flags.length ? <span className="shrink-0 text-[11px] tracking-tight">{quality.flags.slice(0, 3).join(' ')}</span> : null}
            {size ? <span className="shrink-0 text-[11px] tabular-nums text-fg-subtle">{size}</span> : null}
            {quality.seeders != null ? <span className="shrink-0 text-[11px] tabular-nums text-fg-subtle">{quality.seeders}</span> : null}
        </Button>
    );
};

const CuratedStreams = ({ streams }) => {
    const core = useCore();
    const profile = useProfile();
    const screen = useScreenCapability();
    const [preset, setPreset] = React.useState('auto');
    const [showAll, setShowAll] = React.useState(false);

    // The wanted language IS the core subtitles-language setting (one source of
    // truth: the player reads the same field to pick the default subtitle track).
    // Defaults to the interface language until the user picks something.
    const lang = React.useMemo(() => {
        return languages.toCode(profile.settings.subtitlesLanguage || interfaceLangCode(profile.settings.interfaceLanguage));
    }, [profile.settings.subtitlesLanguage, profile.settings.interfaceLanguage]);

    const setLang = React.useCallback((code) => {
        core.transport.dispatch({
            action: 'Ctx',
            args: {
                action: 'UpdateSettings',
                args: { ...profile.settings, subtitlesLanguage: code }
            }
        });
    }, [core, profile.settings]);

    // First run: persist the interface-language default so the player downloads
    // matching subtitles out of the box (the core treats null as "no default").
    // Fires at most once per mount (ref guard), but goes through real deps so
    // the dispatched settings spread is the CURRENT profile, never a stale
    // mount-time snapshot.
    const defaultedLang = React.useRef(false);
    React.useEffect(() => {
        if (defaultedLang.current) return;
        defaultedLang.current = true;
        if (profile.settings.subtitlesLanguage === null) setLang(lang);
    }, [profile.settings.subtitlesLanguage, lang, setLang]);

    const langOptions = React.useMemo(() => {
        const available = availableLanguages(streams);
        const set = new Set(['eng', interfaceLangCode(profile.settings.interfaceLanguage), lang, ...available]);
        return [...set].sort((a, b) => languages.label(a).localeCompare(languages.label(b)));
    }, [streams, profile.settings.interfaceLanguage, lang]);

    const curated = React.useMemo(() => curateStreams(streams, lang), [streams, lang]);
    const rec = React.useMemo(() => recommendStream(curated, preset, screen, lang), [curated, preset, screen, lang]);
    const { picks, rest } = curated;

    // When Speed recommends a stream outside the tier picks, surface it as its own
    // "Fastest" tile so the recommendation is always visible in the carousel.
    const tiles = React.useMemo(() => {
        const base = picks.map((p, i) => ({ ...p, highlighted: rec ? rec.pickIndex === i : false }));
        if (rec && rec.pickIndex === -1) {
            base.unshift({ tierKey: 'fastest', label: 'Fastest', entry: rec.entry, highlighted: true });
        }
        return base;
    }, [picks, rec]);

    if (!picks.length && !rest.length) return null;

    return (
        <div className="flex flex-col gap-2.5 p-1">
            {/* Controls, one centered row: preset switch | Watch | language. */}
            <div className="flex items-center justify-center gap-2.5">
                <div className="inline-flex gap-0.5 rounded-full bg-white/5 p-0.5">
                    {PRESETS.map((p) => (
                        <Button
                            key={p.key}
                            className={cn('rounded-full px-2.5 py-1 text-xs font-medium transition', preset === p.key ? 'bg-accent text-bg' : 'text-fg-muted hover:text-fg')}
                            onClick={() => setPreset(p.key)}
                        >
                            {p.label}
                        </Button>
                    ))}
                </div>
                {rec ? (
                    <Button
                        href={playHref(rec.entry.stream)}
                        onClick={rec.entry.stream.onClick}
                        className="inline-flex h-9 items-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-bg transition hover:brightness-110 active:scale-[0.98]"
                    >
                        <Icon className="size-4" name="play" />
                        Watch · {rec.label}
                    </Button>
                ) : null}
                <LanguagePicker value={lang} options={langOptions} onSelect={setLang} />
            </div>

            {/* The picks: a horizontal carousel of invisible tiles. */}
            <div className="flex justify-center">
                <div className="flex max-w-full gap-1 overflow-x-auto pb-1 [scrollbar-width:thin]">
                    {tiles.map((p) => (
                        <Tile key={p.tierKey} label={p.label} entry={p.entry} highlighted={p.highlighted} />
                    ))}
                </div>
            </div>

            {rest.length ? (
                <React.Fragment>
                    <Button
                        className="inline-flex items-center gap-1.5 self-center rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-fg-muted transition hover:bg-white/10 hover:text-fg"
                        onClick={() => setShowAll((v) => !v)}
                    >
                        <Icon className={cn('size-3 transition-transform', showAll && 'rotate-180')} name="caret-down" />
                        {showAll ? 'Hide' : `All ${rest.length} streams`}
                    </Button>
                    {showAll ? (
                        <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2 xl:grid-cols-3">
                            {rest.map((entry, i) => (
                                <Row key={i} entry={entry} />
                            ))}
                        </div>
                    ) : null}
                </React.Fragment>
            ) : null}
        </div>
    );
};

module.exports = CuratedStreams;
