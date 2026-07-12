// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { useTranslation } = require('react-i18next');
const filterInvalidDOMProps = require('filter-invalid-dom-props').default;
const { default: Icon } = require('@stremio/stremio-icons/react');
const { useNavigateWithOrigin } = require('rillio-router');
const { default: Button } = require('rillio/components/Button');
const { default: Image } = require('rillio/components/Image');
const Multiselect = require('rillio/components/Multiselect');
const useBinaryState = require('rillio/common/useBinaryState');
const useLibraryItemState = require('rillio/common/useLibraryItemState');
const { ICON_FOR_TYPE } = require('rillio/common/CONSTANTS');
const styles = require('./styles');

const MetaItem = React.memo(({ className, id, type, name, poster, posterShape, posterChangeCursor, progress, newVideos, options, deepLinks, dataset, optionOnSelect, onDismissClick, onPlayClick, watched, inLibrary, ...props }) => {
    const { t } = useTranslation();
    const { navigateWithOrigin } = useNavigateWithOrigin();
    const [menuOpen, onMenuOpen, onMenuClose] = useBinaryState(false);
    // Live library membership/watched state for this card, looked up by meta id
    // in a single shared subscription. Falls back to the serialized props until
    // the shared store has loaded. When no id is resolvable, hasId is false and
    // the toggle buttons are not rendered.
    const libraryFallback = React.useMemo(() => ({
        inLibrary: !!inLibrary,
        watched: !!watched
    }), [inLibrary, watched]);
    const libraryState = useLibraryItemState(id, libraryFallback);
    const isWatched = libraryState.hasId ? libraryState.watched : !!watched;
    // The object AddToLibrary / MetaItemMarkAsWatched expect is a meta preview.
    // Prefer an explicit dataset preview, otherwise reconstruct the essentials
    // from this card's own fields (no function props, so it serializes cleanly).
    const metaPreview = React.useMemo(() => {
        if (dataset && typeof dataset === 'object' && typeof dataset.id === 'string') {
            return dataset;
        }

        return typeof id === 'string' && id.length > 0 ?
            { id, type, name, poster, posterShape }
            :
            null;
    }, [dataset, id, type, name, poster, posterShape]);
    const onToggleInLibraryClick = React.useCallback((event) => {
        event.nativeEvent.selectPrevented = true;
        libraryState.toggleInLibrary(metaPreview);
    }, [libraryState.toggleInLibrary, metaPreview]);
    const onToggleWatchedClick = React.useCallback((event) => {
        event.nativeEvent.selectPrevented = true;
        libraryState.toggleWatched(metaPreview);
    }, [libraryState.toggleWatched, metaPreview]);
    const href = React.useMemo(() => {
        return deepLinks ?
            typeof deepLinks.metaDetailsStreams === 'string' ?
                deepLinks.metaDetailsStreams
                :
                typeof deepLinks.metaDetailsVideos === 'string' ?
                    deepLinks.metaDetailsVideos
                    :
                    typeof deepLinks.player === 'string' ?
                        deepLinks.player
                        :
                        null
            :
            null;
    }, [deepLinks]);
    const metaItemOnClick = React.useCallback((event) => {
        if (event.nativeEvent.selectPrevented) {
            event.preventDefault();
        } else if (typeof href === 'string') {
            event.preventDefault();
            navigateWithOrigin(href);
        } else if (typeof props.onClick === 'function') {
            props.onClick(event);
        }
    }, [href, navigateWithOrigin, props.onClick]);
    const menuOnClick = React.useCallback((event) => {
        event.nativeEvent.selectPrevented = true;
    }, []);
    // Inner overlay controls (dismiss X, play) must not also trigger the card's
    // navigate. selectPrevented is the same flag the menu uses: metaItemOnClick
    // sees it on the bubbled native event and preventDefaults instead of opening.
    const onDismissLayerClick = React.useCallback((event) => {
        event.nativeEvent.selectPrevented = true;
        if (typeof onDismissClick === 'function') {
            onDismissClick(event);
        }
    }, [onDismissClick]);
    const onPlayLayerClick = React.useCallback((event) => {
        event.nativeEvent.selectPrevented = true;
        if (typeof onPlayClick === 'function') {
            onPlayClick(event);
        }
    }, [onPlayClick]);
    const menuOnSelect = React.useCallback((event) => {
        if (typeof optionOnSelect === 'function') {
            optionOnSelect({
                type: 'select-option',
                value: event.value,
                dataset: dataset,
                reactEvent: event.reactEvent,
                nativeEvent: event.nativeEvent
            });
        }
    }, [dataset, optionOnSelect]);
    const renderPosterFallback = React.useCallback(() => (
        <Icon
            className={styles['placeholder-icon']}
            name={ICON_FOR_TYPE.has(type) ? ICON_FOR_TYPE.get(type) : ICON_FOR_TYPE.get('other')}
        />
    ), [type]);
    const renderMenuLabelContent = React.useCallback(() => (
        <Icon className={styles['icon']} name={'more-vertical'} />
    ), []);
    return (
        <Button title={name} href={href} {...filterInvalidDOMProps(props)} className={classnames(className, styles['meta-item-container'], styles['poster-shape-poster'], styles[`poster-shape-${posterShape}`], { 'active': menuOpen })} onClick={metaItemOnClick}>
            <div className={classnames(styles['poster-container'], { 'poster-change-cursor': posterChangeCursor })}>
                {
                    onDismissClick ?
                        <div title={t('LIBRARY_RESUME_DISMISS')} className={styles['dismiss-icon-layer']} onClick={onDismissLayerClick}>
                            <Icon className={styles['dismiss-icon']} name={'close'} />
                            <div className={styles['dismiss-icon-backdrop']} />
                        </div>
                        :
                        null
                }
                {
                    isWatched ?
                        <div className={styles['watched-icon-layer']}>
                            <Icon className={styles['watched-icon']} name={'checkmark'} />
                        </div>
                        :
                        null
                }
                {
                    libraryState.hasId ?
                        <div className={styles['action-buttons-layer']}>
                            <div
                                title={libraryState.inLibrary ? t('REMOVE_FROM_LIB') : t('ADD_TO_LIB')}
                                className={styles['action-button']}
                                onClick={onToggleInLibraryClick}
                            >
                                <Icon
                                    className={styles['action-button-icon']}
                                    name={libraryState.inLibrary ? 'remove-from-library' : 'add-to-library'}
                                />
                            </div>
                            <div
                                title={isWatched ? t('CTX_MARK_UNWATCHED') : t('CTX_MARK_WATCHED')}
                                className={styles['action-button']}
                                onClick={onToggleWatchedClick}
                            >
                                <Icon
                                    className={styles['action-button-icon']}
                                    name={isWatched ? 'eye-off' : 'eye'}
                                />
                            </div>
                        </div>
                        :
                        null
                }
                <div className={styles['poster-image-layer']}>
                    <Image
                        className={styles['poster-image']}
                        src={poster}
                        alt={' '}
                        renderFallback={renderPosterFallback}
                    />
                </div>
                {
                    onPlayClick ?
                        <div title={t('CONTINUE_WATCHING')} className={styles['play-icon-layer']} onClick={onPlayLayerClick}>
                            <Icon className={styles['play-icon']} name={'play'} />
                            <div className={styles['play-icon-outer']} />
                            <div className={styles['play-icon-background']} />
                        </div>
                        :
                        null
                }
                {
                    progress > 0 ?
                        <div className={styles['progress-bar-layer']}>
                            <div className={styles['progress-bar']} style={{ width: `${progress}%` }} />
                            <div className={styles['progress-bar-background']} />
                        </div>
                        :
                        null
                }
                {
                    newVideos > 0 ?
                        <div className={styles['new-videos']}>
                            <div className={styles['layer']} />
                            <div className={styles['layer']} />
                            <div className={styles['layer']}>
                                <Icon className={styles['icon']} name={'add'} />
                                <div className={styles['label']}>
                                    {newVideos}
                                </div>
                            </div>
                        </div>
                        :
                        null
                }
            </div>
            {
                (typeof name === 'string' && name.length > 0) || (Array.isArray(options) && options.length > 0) ?
                    <div className={styles['title-bar-container']}>
                        <div className={styles['title-label']}>
                            {typeof name === 'string' && name.length > 0 ? name : ''}
                        </div>
                        {
                            Array.isArray(options) && options.length > 0 ?
                                <Multiselect
                                    className={styles['menu-label-container']}
                                    renderLabelContent={renderMenuLabelContent}
                                    options={options}
                                    onOpen={onMenuOpen}
                                    onClose={onMenuClose}
                                    onSelect={menuOnSelect}
                                    tabIndex={-1}
                                    onClick={menuOnClick}
                                />
                                :
                                null
                        }
                    </div>
                    :
                    null
            }
        </Button>
    );
});

MetaItem.displayName = 'MetaItem';

MetaItem.propTypes = {
    className: PropTypes.string,
    id: PropTypes.string,
    type: PropTypes.string,
    name: PropTypes.string,
    poster: PropTypes.string,
    posterShape: PropTypes.oneOf(['poster', 'landscape', 'square']),
    posterChangeCursor: PropTypes.bool,
    progress: PropTypes.number,
    newVideos: PropTypes.number,
    options: PropTypes.array,
    deepLinks: PropTypes.shape({
        metaDetailsVideos: PropTypes.string,
        metaDetailsStreams: PropTypes.string,
        player: PropTypes.string
    }),
    dataset: PropTypes.object,
    optionOnSelect: PropTypes.func,
    onDismissClick: PropTypes.func,
    onPlayClick: PropTypes.func,
    onClick: PropTypes.func,
    watched: PropTypes.bool,
    inLibrary: PropTypes.bool
};

module.exports = MetaItem;
