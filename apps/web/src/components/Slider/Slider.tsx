// Copyright (C) 2017-2026 Smart code 203358507

/**
 * Slider (buffered range + audio-boost zone) ported to Tailwind. The drag model is
 * preserved verbatim from the legacy implementation: pointer-down grabs the thumb at
 * the WINDOW level (mouse/touch move + up + blur listeners on `window`), so scrubbing
 * keeps tracking even when the cursor leaves the bar; `active-slider-within` is added
 * to <html> during the grab (its grabbing-cursor + body pointer-events-off rule lives
 * in styles/tailwind.css). onSlide fires continuously (RAF-throttled), onComplete on
 * release. Route-blur / disable release the grab.
 *
 * The hashed CSS-module part classes are gone: each visual part now takes a plain
 * className prop (trackClassName / bufferedClassName / filledClassName / thumbClassName)
 * so consumers (SeekBar, VolumeSlider) theme parts directly with Tailwind. The
 * audio-boost >100% color band is kept INSIDE the component (an inline background-image
 * gradient that survives consumer background-color classes), because it is the
 * load-bearing detail no stock slider provides.
 */

import React, { useCallback, useLayoutEffect, useRef } from 'react';
import useRouteFocused from 'rillio/common/useRouteFocused';
import useAnimationFrame from 'rillio/common/useAnimationFrame';
import useLiveRef from 'rillio/common/useLiveRef';
import { cn } from 'rillio/components/ui/cn';

const ACTIVE_SLIDER_CLASS = 'active-slider-within';

// The >100% audio-boost band: neutral up to the midpoint (100%), warming into
// warning then danger toward 200%. Kept identical to the legacy gradient.
const AUDIO_BOOST_GRADIENT = 'linear-gradient(to right, ' +
    'var(--primary-foreground-color) 0%, ' +
    'var(--primary-foreground-color) 50%, ' +
    'var(--color-warning) 75%, ' +
    'var(--color-danger) 100%)';

type Props = {
    className?: string;
    trackClassName?: string;
    bufferedClassName?: string;
    filledClassName?: string;
    thumbClassName?: string;
    value?: number | null;
    buffered?: number | null;
    minimumValue?: number | null;
    maximumValue?: number | null;
    disabled?: boolean;
    onSlide?: (value: number) => void;
    onComplete?: (value: number) => void;
    audioBoost?: boolean;
};

const Slider = ({
    className,
    trackClassName,
    bufferedClassName,
    filledClassName,
    thumbClassName,
    value,
    buffered,
    minimumValue,
    maximumValue,
    disabled,
    onSlide,
    onComplete,
    audioBoost,
}: Props) => {
    const minimumValueRef = useLiveRef(minimumValue !== null && minimumValue !== undefined && !isNaN(minimumValue) ? minimumValue : 0);
    const maximumValueRef = useLiveRef(maximumValue !== null && maximumValue !== undefined && !isNaN(maximumValue) ? maximumValue : 100);
    const valueRef = useLiveRef(value !== null && value !== undefined && !isNaN(value) ? Math.min(maximumValueRef.current, Math.max(minimumValueRef.current, value)) : 0);
    const bufferedRef = useLiveRef(buffered !== null && buffered !== undefined && !isNaN(buffered) ? Math.min(maximumValueRef.current, Math.max(minimumValueRef.current, buffered)) : 0);
    const onSlideRef = useLiveRef(onSlide);
    const onCompleteRef = useLiveRef(onComplete);
    const sliderContainerRef = useRef<HTMLDivElement>(null);
    const routeFocused = useRouteFocused();
    const [requestThumbAnimation, cancelThumbAnimation] = useAnimationFrame();
    const calculateValueForMouseX = useCallback((mouseX: number) => {
        if (sliderContainerRef.current === null) {
            return 0;
        }

        const { x: sliderX, width: sliderWidth } = sliderContainerRef.current.getBoundingClientRect();
        const thumbStart = Math.min(Math.max(mouseX - sliderX, 0), sliderWidth);
        const value = (thumbStart / sliderWidth) * (maximumValueRef.current - minimumValueRef.current) + minimumValueRef.current;
        return value;
    }, []);
    const retainThumb = useCallback(() => {
        window.addEventListener('blur', onBlur);
        window.addEventListener('mouseup', onMouseUp);
        window.addEventListener('touchend', onTouchEnd);
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('touchmove', onTouchMove);
        document.documentElement.classList.add(ACTIVE_SLIDER_CLASS);
    }, []);
    const releaseThumb = useCallback(() => {
        cancelThumbAnimation();
        window.removeEventListener('blur', onBlur);
        window.removeEventListener('mouseup', onMouseUp);
        window.removeEventListener('touchend', onTouchEnd);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('touchmove', onTouchMove);
        document.documentElement.classList.remove(ACTIVE_SLIDER_CLASS);
    }, []);
    const onBlur = useCallback(() => {
        if (typeof onSlideRef.current === 'function') {
            onSlideRef.current(valueRef.current);
        }

        if (typeof onCompleteRef.current === 'function') {
            onCompleteRef.current(valueRef.current);
        }

        releaseThumb();
    }, []);
    const onMouseUp = useCallback((event: MouseEvent) => {
        const value = calculateValueForMouseX(event.clientX);
        if (typeof onCompleteRef.current === 'function') {
            onCompleteRef.current(value);
        }

        releaseThumb();
    }, []);
    const onMouseMove = useCallback((event: MouseEvent) => {
        requestThumbAnimation(() => {
            const value = calculateValueForMouseX(event.clientX);
            if (typeof onSlideRef.current === 'function') {
                onSlideRef.current(value);
            }
        });
    }, []);
    const onMouseDown = useCallback((event: React.MouseEvent) => {
        if (event.button !== 0) {
            return;
        }

        const value = calculateValueForMouseX(event.clientX);
        if (typeof onSlideRef.current === 'function') {
            onSlideRef.current(value);
        }

        retainThumb();
    }, []);
    const onTouchStart = useCallback((event: React.TouchEvent) => {
        const touch = event.touches[0];
        const value = calculateValueForMouseX(touch.clientX);
        if (typeof onSlideRef.current === 'function') {
            onSlideRef.current(value);
        }

        retainThumb();
        event.preventDefault();
    }, []);
    const onTouchMove = useCallback((event: TouchEvent) => {
        requestThumbAnimation(() => {
            const touch = event.touches[0];
            const value = calculateValueForMouseX(touch.clientX);
            if (typeof onSlideRef.current === 'function') {
                onSlideRef.current(value);
            }
        });

        event.preventDefault();
    }, []);
    const onTouchEnd = useCallback((event: TouchEvent) => {
        const touch = event.changedTouches[0];
        const value = calculateValueForMouseX(touch.clientX);
        if (typeof onCompleteRef.current === 'function') {
            onCompleteRef.current(value);
        }

        releaseThumb();
    }, []);
    useLayoutEffect(() => {
        if (!routeFocused || disabled) {
            releaseThumb();
        }
    }, [routeFocused, disabled]);
    useLayoutEffect(() => {
        return () => {
            releaseThumb();
        };
    }, []);
    const thumbPosition = Math.max(0, Math.min(1, (valueRef.current - minimumValueRef.current) / (maximumValueRef.current - minimumValueRef.current)));
    const bufferedPosition = Math.max(0, Math.min(1, (bufferedRef.current - minimumValueRef.current) / (maximumValueRef.current - minimumValueRef.current)));
    const maskWidth = `calc(${thumbPosition.toFixed(3)} * 100%)`;
    const filledMask = `linear-gradient(to right, black 0%, black ${maskWidth}, transparent ${maskWidth})`;

    const layer = 'absolute inset-0 z-0 flex flex-row items-center overflow-visible';

    return (
        <div
            ref={sliderContainerRef}
            className={cn(
                'group relative z-0 cursor-pointer overflow-visible',
                disabled && 'pointer-events-none opacity-50',
                className,
            )}
            onMouseDown={onMouseDown}
            onTouchStart={onTouchStart}
        >
            <div className={layer}>
                <div
                    className={cn(
                        'h-(--track-size) w-full flex-1 rounded-(--track-size)',
                        !audioBoost && 'bg-(--primary-accent-color) opacity-20',
                        trackClassName,
                    )}
                    style={audioBoost ? { backgroundImage: AUDIO_BOOST_GRADIENT, opacity: 0.3 } : undefined}
                />
            </div>
            <div className={layer}>
                <div
                    className={cn('h-(--track-size) flex-none rounded-(--track-size) bg-(--overlay-color)', bufferedClassName)}
                    style={{ width: `calc(100% * ${bufferedPosition})` }}
                />
            </div>
            <div className={layer}>
                <div
                    className={cn(
                        'h-(--track-size) w-full flex-none rounded-(--track-size)',
                        !audioBoost && 'bg-(--primary-accent-color)',
                        filledClassName,
                    )}
                    style={{
                        maskImage: filledMask,
                        WebkitMaskImage: filledMask,
                        ...(audioBoost ? { backgroundImage: AUDIO_BOOST_GRADIENT } : null),
                    }}
                />
            </div>
            <div className={layer}>
                <div
                    className={cn(
                        'relative z-[3] size-(--thumb-size) flex-none -translate-x-1/2 rounded-full bg-(--primary-foreground-color)',
                        thumbClassName,
                    )}
                    style={{ marginLeft: `calc(100% * ${thumbPosition.toFixed(3)})` }}
                />
            </div>
        </div>
    );
};

export default Slider;
