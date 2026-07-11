import React from 'react';
import classnames from 'classnames';
import Icon from '@stremio/stremio-icons/react';
import styles from './styles.less';

type Props = {
    className?: string,
    ytIds?: string[],
    background?: string | null,
    poster?: string | null,
    name?: string,
};

type Slide =
    | { type: 'image', src: string }
    | { type: 'video', ytId: string };

// The hero's 16:9 media panel: a banner carousel. Slides are the backdrop image
// plus each trailer as a VIDEO slide, paused by default (autoplay=0, the user
// presses YouTube's own play). Image slides auto-advance gently; a video slide
// never auto-advances (the user may be watching). The poster is portrait so it is
// only used when there is no backdrop at all.
const AUTO_ADVANCE_MS = 7000;

const HeroMedia = ({ className, ytIds, background, poster, name }: Props) => {
    const slides = React.useMemo<Slide[]>(() => {
        const out: Slide[] = [];
        const still = background || poster || null;
        if (still) out.push({ type: 'image', src: still });
        (ytIds || []).slice(0, 3).forEach((ytId) => out.push({ type: 'video', ytId }));
        return out;
    }, [ytIds, background, poster]);

    const [active, setActive] = React.useState(0);
    const count = slides.length;

    const go = React.useCallback((delta: number) => {
        setActive((a) => (a + delta + count) % count);
    }, [count]);

    // Gentle auto-advance, image slides only (a paused/playing trailer stays put).
    React.useEffect(() => {
        if (count < 2 || slides[active]?.type !== 'image') return undefined;
        const id = setTimeout(() => setActive((a) => (a + 1) % count), AUTO_ADVANCE_MS);
        return () => clearTimeout(id);
    }, [active, count, slides]);

    // Meta changed (new title): restart from the first slide.
    React.useEffect(() => { setActive(0); }, [slides]);

    if (count === 0) {
        return (
            <div className={classnames(className, styles['hero-media'])}>
                <div className={styles['still-empty']} />
            </div>
        );
    }

    return (
        <div className={classnames(className, styles['hero-media'])}>
            {slides.map((slide, index) => (
                slide.type === 'image' ?
                    <img
                        key={index}
                        className={classnames(styles['still'], { [styles['slide-hidden']]: index !== active })}
                        src={slide.src}
                        alt={name || ''}
                    />
                    :
                    // Mount the iframe only while its slide is active so a playing
                    // trailer stops when the user cycles away.
                    index === active ?
                        <iframe
                            key={index}
                            className={styles['trailer']}
                            src={`https://www.youtube-nocookie.com/embed/${slide.ytId}?autoplay=0&controls=1&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3`}
                            title={name || 'Trailer'}
                            allow={'encrypted-media; picture-in-picture'}
                            allowFullScreen
                        />
                        :
                        null
            ))}

            {
                count > 1 ?
                    <React.Fragment>
                        <button type={'button'} className={classnames(styles['arrow'], styles['arrow-left'])} aria-label={'Previous'} onClick={() => go(-1)}>
                            <Icon className={styles['arrow-icon']} name={'chevron-back'} />
                        </button>
                        <button type={'button'} className={classnames(styles['arrow'], styles['arrow-right'])} aria-label={'Next'} onClick={() => go(1)}>
                            <Icon className={styles['arrow-icon']} name={'chevron-forward'} />
                        </button>
                        <div className={styles['dots']}>
                            {slides.map((slide, index) => (
                                <button
                                    key={index}
                                    type={'button'}
                                    aria-label={slide.type === 'video' ? 'Trailer' : 'Image'}
                                    className={classnames(styles['dot'], { [styles['dot-active']]: index === active, [styles['dot-video']]: slide.type === 'video' })}
                                    onClick={() => setActive(index)}
                                />
                            ))}
                        </div>
                    </React.Fragment>
                    :
                    null
            }
        </div>
    );
};

export default HeroMedia;
