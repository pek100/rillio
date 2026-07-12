// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const { useTranslation } = require('react-i18next');
const PropTypes = require('prop-types');
const classNames = require('classnames');
const { default: Icon } = require('@stremio/stremio-icons/react');
const { Button } = require('rillio/components');
const styles = require('./styles');

const Error = React.forwardRef(({ className, code, message, stream, onTryDifferentSource }, ref) => {
    const { t } = useTranslation();

    const [playlist, fileName] = React.useMemo(() => {
        return [
            stream?.deepLinks?.externalPlayer?.playlist,
            stream?.deepLinks?.externalPlayer?.fileName,
        ];
    }, [stream]);

    return (
        <div ref={ref} className={classNames(className, styles['error'])}>
            <div className={styles['error-label']} title={message}>{message}</div>
            {
                code === 2 ?
                    <div className={styles['error-sub']} title={t('EXTERNAL_PLAYER_HINT')}>{t('EXTERNAL_PLAYER_HINT')}</div>
                    :
                    null
            }
            {
                typeof onTryDifferentSource === 'function' ?
                    <button
                        type={'button'}
                        onClick={onTryDifferentSource}
                        className={'pointer-events-auto mt-4 rounded-full bg-accent px-5 py-2 text-sm font-semibold text-bg transition hover:brightness-110'}
                    >
                        Try a different source
                    </button>
                    :
                    null
            }
            {
                playlist && fileName ?
                    <Button
                        className={styles['playlist-button']}
                        title={t('PLAYER_OPEN_IN_EXTERNAL')}
                        href={playlist}
                        download={fileName}
                        target={'_blank'}
                    >
                        <Icon className={styles['icon']} name={'ic_downloads'} />
                        <div className={styles['label']}>{t('PLAYER_OPEN_IN_EXTERNAL')}</div>
                    </Button>
                    :
                    null
            }
        </div>
    );
});

Error.propTypes = {
    className: PropTypes.string,
    code: PropTypes.number,
    message: PropTypes.string,
    stream: PropTypes.object,
    onTryDifferentSource: PropTypes.func,
};

module.exports = Error;
