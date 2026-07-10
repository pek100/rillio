// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const { useTranslation } = require('react-i18next');
const { useParams } = require('react-router');
const { useSearchParams } = require('react-router-dom');
const classnames = require('classnames');
const { default: Icon } = require('@stremio/stremio-icons/react');
const { CONSTANTS, useBinaryState, useOnScrollToBottom, withCoreSuspender } = require('rillio/common');
const { AddonDetailsModal, Button, DelayedRenderer, Image, MainNavBars, MetaItem, ModalDialog, MultiselectMenu } = require('rillio/components');
const useDiscover = require('./useDiscover');
const useSelectableInputs = require('./useSelectableInputs');
const styles = require('./styles');

const SCROLL_TO_BOTTOM_THRESHOLD = 400;

const Discover = () => {
    const { type, transportUrl, catalogId } = useParams();
    const urlParams = React.useMemo(() => ({
        type,
        transportUrl,
        catalogId
    }), [type, transportUrl, catalogId]);
    const [queryParams] = useSearchParams();
    const { t } = useTranslation();
    const [discover, loadNextPage] = useDiscover(urlParams, queryParams);
    const [selectInputs, hasNextPage] = useSelectableInputs(discover);
    const [inputsModalOpen, openInputsModal, closeInputsModal] = useBinaryState(false);
    const [addonModalOpen, openAddonModal, closeAddonModal] = useBinaryState(false);
    // Still tracked so keyboard/gamepad focus highlights the active poster.
    const [selectedMetaItemIndex, setSelectedMetaItemIndex] = React.useState(0);

    const metasContainerRef = React.useRef();

    React.useEffect(() => {
        if (discover.catalog?.content.type === 'Loading') {
            metasContainerRef.current.scrollTop = 0;
        }
    }, [discover.catalog]);
    React.useEffect(() => {
        if (hasNextPage && metasContainerRef.current) {
            const containerHeight = metasContainerRef.current.scrollHeight;
            const viewportHeight = metasContainerRef.current.clientHeight;
            if (containerHeight <= viewportHeight + SCROLL_TO_BOTTOM_THRESHOLD) {
                loadNextPage();
            }
        }
    }, [hasNextPage, loadNextPage]);
    const metaItemsOnFocusCapture = React.useCallback((event) => {
        if (event.target.dataset.index !== null && !isNaN(event.target.dataset.index)) {
            setSelectedMetaItemIndex(parseInt(event.target.dataset.index, 10));
        }
    }, []);
    const onScrollToBottom = React.useCallback(() => {
        if (hasNextPage) {
            loadNextPage();
        }
    }, [hasNextPage, loadNextPage]);
    const onScroll = useOnScrollToBottom(onScrollToBottom, SCROLL_TO_BOTTOM_THRESHOLD);
    React.useEffect(() => {
        closeInputsModal();
        closeAddonModal();
        setSelectedMetaItemIndex(0);
    }, [discover.selected]);
    return (
        <MainNavBars className={styles['discover-container']} route={'discover'}>
            <div className={styles['discover-content']}>
                <div className={styles['catalog-container']}>
                    <div className={styles['selectable-inputs-container']}>
                        {selectInputs.map(({ title, options, value, onSelect }, index) => (
                            <MultiselectMenu
                                key={index}
                                className={styles['select-input']}
                                title={title}
                                options={options}
                                value={value}
                                onSelect={onSelect}
                            />
                        ))}
                        <div className={styles['filter-container']}>
                            <Button className={styles['filter-button']} title={t('ALL_FILTERS')} onClick={openInputsModal}>
                                <Icon className={styles['filter-icon']} name={'filters'} />
                            </Button>
                        </div>
                    </div>
                    {
                        discover.catalog !== null && !discover.catalog.installed ?
                            <div className={styles['missing-addon-warning-container']}>
                                <div className={styles['warning-label']}>{t('ERR_ADDON_NOT_INSTALLED')}</div>
                                <Button className={styles['install-button']} title={t('INSTALL_ADDON')} onClick={openAddonModal}>
                                    <div className={styles['label']}>{t('ADDON_INSTALL')}</div>
                                </Button>
                            </div>
                            :
                            null
                    }
                    {
                        discover.catalog === null ?
                            <DelayedRenderer delay={500}>
                                <div className={styles['message-container']}>
                                    <Image className={styles['image']} src={require('/assets/images/empty.svg')} alt={' '} />
                                    <div className={styles['message-label']}>{t('NO_CATALOG_SELECTED')}</div>
                                </div>
                            </DelayedRenderer>
                            :
                            discover.catalog.content.type === 'Err' ?
                                <div className={styles['message-container']}>
                                    <Image className={styles['image']} src={require('/assets/images/empty.svg')} alt={' '} />
                                    <div className={styles['message-label']}>{discover.catalog.content.content}</div>
                                </div>
                                :
                                discover.catalog.content.type === 'Loading' ?
                                    <div ref={metasContainerRef} className={classnames(styles['meta-items-container'], 'animation-fade-in')}>
                                        {Array(CONSTANTS.CATALOG_PAGE_SIZE).fill(null).map((_, index) => (
                                            <div key={index} className={styles['meta-item-placeholder']}>
                                                <div className={styles['poster-container']} />
                                                <div className={styles['title-bar-container']}>
                                                    <div className={styles['title-label']} />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    :
                                    <div ref={metasContainerRef} className={classnames(styles['meta-items-container'], 'animation-fade-in')} onScroll={onScroll} onFocusCapture={metaItemsOnFocusCapture}>
                                        {discover.catalog.content.content.map((metaItem, index) => (
                                            <MetaItem
                                                key={index}
                                                className={classnames({ 'selected': selectedMetaItemIndex === index })}
                                                type={metaItem.type}
                                                name={metaItem.name}
                                                poster={metaItem.poster}
                                                posterShape={metaItem.posterShape}
                                                playname={selectedMetaItemIndex === index}
                                                deepLinks={metaItem.deepLinks}
                                                watched={metaItem.watched}
                                                data-index={index}
                                            />
                                        ))}
                                    </div>
                    }
                </div>
            </div>
            {
                inputsModalOpen ?
                    <ModalDialog title={t('CATALOG_FILTERS')} className={styles['selectable-inputs-modal']} onCloseRequest={closeInputsModal}>
                        {selectInputs.map(({ title, options, value, onSelect }, index) => (
                            <MultiselectMenu
                                key={index}
                                className={styles['select-input']}
                                title={title}
                                options={options}
                                value={value}
                                onSelect={onSelect}
                            />
                        ))}
                    </ModalDialog>
                    :
                    null
            }
            {
                addonModalOpen && discover.selected !== null ?
                    <AddonDetailsModal transportUrl={discover.selected.request.base} onCloseRequest={closeAddonModal} />
                    :
                    null
            }
        </MainNavBars>
    );
};

const DiscoverFallback = () => (
    <MainNavBars className={styles['discover-container']} route={'discover'} />
);

module.exports = withCoreSuspender(Discover, DiscoverFallback);
