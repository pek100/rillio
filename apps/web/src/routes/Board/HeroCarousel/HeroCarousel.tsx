import React from 'react';
import classnames from 'classnames';
import { useTranslation } from 'react-i18next';
import Icon from '@stremio/stremio-icons/react';
import styles from './styles.less';

const Button = require('rillio/components/Button').default;

const ROTATE_MS = 7000;
// How many cards are visible on each side of the front one.
const VISIBLE_SIDES = 3;

type Props = {
    className?: string,
    items: any[],
};

// The board's hero: the active title's backdrop fills the banner as ambience
// (cover + scrim, so odd crops never matter), the copy sits on the left, and the
// right side is a 3D poster coverflow, every item's poster fans out in
// perspective, the front card is the active one, side cards click to select.
// Rotates every 7s, pauses on hover.
const HeroCarousel = ({ className, items }: Props) => {
    const { t } = useTranslation();
    const [index, setIndex] = React.useState(0);
    const [paused, setPaused] = React.useState(false);
    const count = items.length;

    React.useEffect(() => {
        if (count > 0 && index >= count) {
            setIndex(0);
        }
    }, [count, index]);

    React.useEffect(() => {
        if (paused || count <= 1) {
            return;
        }

        const id = setInterval(() => setIndex((i) => (i + 1) % count), ROTATE_MS);
        return () => clearInterval(id);
    }, [paused, count]);

    const pause = React.useCallback(() => setPaused(true), []);
    const resume = React.useCallback(() => setPaused(false), []);

    if (count === 0) {
        return null;
    }

    const item = items[Math.min(index, count - 1)];
    const deepLinks = item.deepLinks || {};
    const watchHref = deepLinks.metaDetailsStreams || deepLinks.player || deepLinks.metaDetailsVideos || null;
    const infoHref = deepLinks.metaDetailsVideos || deepLinks.metaDetailsStreams || null;

    return (
        <div className={classnames(className, styles['hero-carousel'])} onMouseEnter={pause} onMouseLeave={resume}>
            <div className={styles['slides']}>
                {
                    items.map((it, i) => (
                        <img
                            key={it.id || i}
                            className={classnames(styles['backdrop'], { [styles['active']]: i === index })}
                            src={it.background || it.poster || ''}
                            alt={''}
                        />
                    ))
                }
            </div>
            <div className={styles['scrim']} />

            <div className={styles['content']}>
                {
                    typeof item.logo === 'string' && item.logo.length > 0 ?
                        <img className={styles['logo']} src={item.logo} alt={item.name} />
                        :
                        <div className={styles['title']}>{item.name}</div>
                }
                {
                    typeof item.description === 'string' && item.description.length > 0 ?
                        <div className={styles['description']}>{item.description}</div>
                        :
                        null
                }
                <div className={styles['actions']}>
                    {
                        watchHref ?
                            <Button className={styles['watch-button']} href={watchHref} title={t('WATCH_NOW')}>
                                <Icon className={styles['icon']} name={'play'} />
                                <div className={styles['label']}>{t('WATCH_NOW')}</div>
                            </Button>
                            :
                            null
                    }
                    {
                        infoHref ?
                            <Button className={styles['info-button']} href={infoHref} title={t('MORE_INFO')}>
                                <div className={styles['label']}>{t('MORE_INFO')}</div>
                            </Button>
                            :
                            null
                    }
                </div>
            </div>

            {/* Poster coverflow: signed circular distance from the active card
                drives each card's translate/rotate/scale. The front card links to
                the title; side cards select on click. */}
            <div className={styles['coverflow']}>
                {
                    items.map((it, i) => {
                        let d = (((i - index) % count) + count) % count;
                        if (d > count / 2) d -= count;
                        const abs = Math.abs(d);
                        const hidden = abs > VISIBLE_SIDES;
                        const front = d === 0;
                        return (
                            <Button
                                key={it.id || i}
                                className={classnames(styles['card'], { [styles['front']]: front })}
                                title={it.name}
                                href={front ? (it.deepLinks?.metaDetailsVideos || it.deepLinks?.metaDetailsStreams || null) : null}
                                onClick={front ? undefined : () => setIndex(i)}
                                style={{
                                    transform: `translate(-50%, -50%) translateX(${d * 58}%) translateZ(${-abs * 5}rem) rotateY(${d * -24}deg)`,
                                    zIndex: 30 - abs,
                                    opacity: hidden ? 0 : 1,
                                    pointerEvents: hidden ? 'none' : 'auto',
                                }}
                            >
                                <img className={styles['card-poster']} src={it.poster || it.background || ''} alt={''} loading={'lazy'} />
                            </Button>
                        );
                    })
                }
            </div>

            {
                count > 1 ?
                    <div className={styles['dots']}>
                        {
                            items.map((it, i) => (
                                <Button
                                    key={it.id || i}
                                    className={classnames(styles['dot'], { [styles['active']]: i === index })}
                                    title={it.name}
                                    onClick={() => setIndex(i)}
                                />
                            ))
                        }
                    </div>
                    :
                    null
            }
        </div>
    );
};

export default HeroCarousel;
