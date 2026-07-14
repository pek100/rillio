// Copyright (C) 2017-2025 Smart code 203358507

/**
 * CuratedStreams (Phase 3 clean-room rewrite).
 *
 * The curated streams view: the single best pick per quality tier in a horizontal
 * tile carousel, a preset switch (Auto / Quality / Speed), a Watch button that
 * plays the recommendation, a language picker, and an expandable "all streams"
 * grid. View-layer rebuilt on the foundation kit (ToggleGroup preset, Popover +
 * Command language combobox, kit Button, Tooltip on the download affordance) and
 * Tailwind tokens; every parser / recommender in streamQuality.js is reused
 * verbatim, as are useScreenCapability / useCacheDownload / the subtitlesLanguage
 * (UpdateSettings) binding. No card chrome: transparent tiles, hover reveal.
 */

import React from 'react';
import { ChevronDown, Play, Download } from 'lucide-react';
import { useCore } from 'rillio/core';
import { useProfile, languages } from 'rillio/common';
import { useScreenCapability } from 'rillio/common/useScreenCapability';
import useCacheDownload from 'rillio/common/useCacheDownload';
import { cn } from 'rillio/components/ui/cn';
import { Button } from 'rillio/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from 'rillio/components/ui/toggle-group';
import { Tooltip } from 'rillio/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from 'rillio/components/ui/popover';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from 'rillio/components/ui/command';
import { curateStreams, recommendStream, flagFor, availableLanguages, formatSize } from './streamQuality';

// Small "download to cache" affordance shared by tiles and rows: only torrent
// streams (infoHash) can be cached, and the click must not trigger the enclosing
// play link. Canonical bare-glyph icon button (explicit square, flex-centered).
const DownloadToCache = ({ stream, className }: { stream: any; className?: string }) => {
    const downloadToCache = useCacheDownload();
    const onClick = React.useCallback((event: React.MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        downloadToCache(stream);
    }, [downloadToCache, stream]);
    if (typeof stream.infoHash !== 'string') {
        return null;
    }
    return (
        <Tooltip label={'Download to cache (watch later, kept on the Cached page)'}>
            <Button
                variant="ghost"
                tabIndex={-1}
                onClick={onClick}
                className={cn('size-6 shrink-0 p-0 text-fg-subtle hover:bg-white/10 hover:text-fg', className)}
            >
                <Download className={'size-3.5'} />
            </Button>
        </Tooltip>
    );
};

const PRESETS = [
    { key: 'auto', label: 'Auto' },
    { key: 'quality', label: 'Quality' },
    { key: 'speed', label: 'Speed' },
];

const badgeFor = (quality: any) => {
    const r = quality.resolution >= 2160 ? '4K' : quality.resolution === 1080 ? '1080p' : quality.resolution ? `${quality.resolution}p` : 'SD';
    return quality.hdr ? `${r} HDR` : r;
};

const providerOf = (stream: any) => {
    const m = /⚙️\s*([^\n]+)/.exec(stream.description || '');
    return m ? m[1].trim() : (stream.addonName || '');
};

const playHref = (stream: any) => (stream.deepLinks ? stream.deepLinks.player : null);

// ISO 639-2 code for the app's interface language ('en-US' -> 'eng').
const interfaceLangCode = (interfaceLanguage: string) =>
    languages.toCode((interfaceLanguage || 'en').split('-')[0]);

// Searchable pill combobox for the wanted audio/subtitles language. Radix Popover
// portals to body (no more hand-rolled position:fixed anchoring inside the
// overflow-clip streams panel).
//
// The list is filtered HERE, with cmdk's own filtering off (shouldFilter={false}),
// and the empty state is ours rather than CommandEmpty. This picker used to lean on
// cmdk's built-in filter/registration and showed "No language" over a list that was
// never empty (it always holds at least English plus the current language). Both of
// the app's other cmdk consumers, the search palette and the nav SearchBar, already
// own their filtering for their own reasons; this one now matches them, so the list
// on screen is just an array we filtered, with no registration/scoring in between.
const LanguagePicker = ({ value, options, onSelect }: { value: string; options: string[]; onSelect: (code: string) => void }) => {
    const [open, setOpen] = React.useState(false);
    const [search, setSearch] = React.useState('');

    const shown = React.useMemo(() => {
        const needle = search.trim().toLowerCase();
        if (needle.length === 0) {
            return options;
        }
        return options.filter((code) => `${languages.label(code)} ${code}`.toLowerCase().includes(needle));
    }, [options, search]);

    // A stale query must not greet the next open with a filtered (or empty) list.
    const onOpenChange = React.useCallback((next: boolean) => {
        setOpen(next);
        if (!next) {
            setSearch('');
        }
    }, []);

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    title="Preferred language"
                    className="h-7 gap-1.5 bg-white/5 px-2.5 text-xs font-medium text-fg-muted hover:bg-white/10 hover:text-fg"
                >
                    <span>{flagFor(value) || '🌐'}</span>
                    {languages.label(value)}
                    <ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={6} className="w-52 p-0">
                <Command shouldFilter={false}>
                    <CommandInput
                        value={search}
                        onValueChange={setSearch}
                        placeholder="Search language"
                        className="h-9"
                    />
                    <CommandList className="max-h-64">
                        {
                            shown.length === 0 ?
                                <div className="py-6 text-center text-sm text-fg-subtle">No language</div>
                                :
                                null
                        }
                        <CommandGroup>
                            {shown.map((code) => (
                                <CommandItem
                                    key={code}
                                    value={`${languages.label(code)} ${code}`}
                                    onSelect={() => { onSelect(code); onOpenChange(false); }}
                                    className={cn(code === value && 'text-accent')}
                                >
                                    <span>{flagFor(code) || '🌐'}</span>
                                    <span className="truncate">{languages.label(code)}</span>
                                    {code === value ? <span className="ml-auto size-2 shrink-0 rounded-full bg-accent" /> : null}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
};

// One carousel tile: tier label on top, provider + size + seeders under it.
// Transparent at rest; the highlighted (recommended) one gets the accent tint.
const Tile = ({ label, entry, highlighted }: { label: string; entry: any; highlighted: boolean }) => {
    const { stream, quality } = entry;
    const size = formatSize(quality.size);
    return (
        <Button
            variant="ghost"
            href={playHref(stream)}
            onClick={stream.onClick}
            title={stream.description}
            className={cn(
                'group flex h-auto w-44 shrink-0 flex-col items-stretch justify-start gap-1 whitespace-normal rounded-xl px-3.5 py-3 text-left font-normal',
                highlighted ? 'bg-accent/10 hover:bg-accent/15' : 'hover:bg-white/5',
            )}
        >
            <div className="flex items-center gap-1.5">
                <span className={cn('text-sm font-semibold', highlighted ? 'text-accent' : 'text-fg')}>{label}</span>
                <Play className={cn('size-3.5 transition', highlighted ? 'text-accent' : 'text-fg-subtle opacity-0 group-hover:opacity-100')} />
                <DownloadToCache stream={stream} className="ml-auto opacity-0 transition group-hover:opacity-100" />
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
const Row = ({ entry }: { entry: any }) => {
    const { stream, quality } = entry;
    const size = formatSize(quality.size);
    return (
        <Button
            variant="ghost"
            href={playHref(stream)}
            onClick={stream.onClick}
            title={stream.description}
            className="group flex h-auto justify-start gap-2.5 whitespace-normal rounded-lg px-2.5 py-2 text-left font-normal hover:bg-white/5"
        >
            <span className="inline-flex w-16 shrink-0 justify-center rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-fg-muted">{badgeFor(quality)}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">{providerOf(stream) || stream.addonName || 'Stream'}</span>
            {quality.flags.length ? <span className="shrink-0 text-[11px] tracking-tight">{quality.flags.slice(0, 3).join(' ')}</span> : null}
            {size ? <span className="shrink-0 text-[11px] tabular-nums text-fg-subtle">{size}</span> : null}
            {quality.seeders != null ? <span className="shrink-0 text-[11px] tabular-nums text-fg-subtle">{quality.seeders}</span> : null}
            <DownloadToCache stream={stream} className="shrink-0 opacity-0 transition group-hover:opacity-100" />
        </Button>
    );
};

const CuratedStreams = ({ streams }: { streams: any[] }) => {
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

    const setLang = React.useCallback((code: string) => {
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
    // Fires at most once per mount (ref guard), but goes through real deps so the
    // dispatched settings spread is the CURRENT profile, never a stale snapshot.
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
        const base: any[] = picks.map((p, i) => ({ ...p, highlighted: rec ? rec.pickIndex === i : false }));
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
                <ToggleGroup
                    type="single"
                    value={preset}
                    onValueChange={(value) => { if (value) setPreset(value); }}
                    className="gap-0.5 rounded-full bg-white/5 p-0.5"
                >
                    {PRESETS.map((p) => (
                        <ToggleGroupItem key={p.key} value={p.key} size="sm" className="h-auto px-2.5 py-1 text-xs font-medium">
                            {p.label}
                        </ToggleGroupItem>
                    ))}
                </ToggleGroup>
                {rec ? (
                    <Button
                        href={playHref(rec.entry.stream)}
                        onClick={rec.entry.stream.onClick}
                        className="h-9 active:scale-[0.98]"
                    >
                        <Play className="size-4" />
                        Watch · {rec.label}
                    </Button>
                ) : null}
                <LanguagePicker value={lang} options={langOptions} onSelect={setLang} />
            </div>

            {/* The picks: a horizontal carousel of invisible tiles, centered. */}
            <div className="mx-auto flex w-fit max-w-full gap-1 overflow-x-auto pb-1 [scrollbar-width:thin]">
                {tiles.map((p) => (
                    <Tile key={p.tierKey} label={p.label} entry={p.entry} highlighted={p.highlighted} />
                ))}
            </div>

            {rest.length ? (
                <React.Fragment>
                    <Button
                        variant="ghost"
                        onClick={() => setShowAll((v) => !v)}
                        className="h-auto self-center gap-1.5 bg-white/5 px-3 py-1 text-xs font-medium text-fg-muted hover:bg-white/10 hover:text-fg"
                    >
                        <ChevronDown className={cn('size-3 transition-transform', showAll && 'rotate-180')} />
                        {showAll ? 'Hide' : `All ${rest.length} streams`}
                    </Button>
                    {showAll ? (
                        <div className="grid grid-cols-1 gap-0.5 duration-200 animate-in fade-in sm:grid-cols-2 xl:grid-cols-3">
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

export default CuratedStreams;
