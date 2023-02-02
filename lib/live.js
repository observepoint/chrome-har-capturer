'use strict';

const Context = require('./context');
const Stats = require('./stats');

class Timer {
    constructor(milliseconds) {
        this._milliseconds = milliseconds;
    }

    start() {
        this.cancel();
        return new Promise((fulfill, reject) => {
            if (typeof this._milliseconds === 'undefined') {
                // wait indefinitely
                return;
            }
            this._id = setTimeout(fulfill, this._milliseconds);
        });
    }

    cancel() {
        clearTimeout(this._id);
    }
}



/* https://stackoverflow.com/a/1527820/2015768 */
/**
 * Returns a random number between min (inclusive) and max (exclusive)
 */
function getRandomArbitrary(min, max) {
    return Math.random() * (max - min) + min;
}

/**
 * Returns a random integer between min (inclusive) and max (inclusive).
 * The value is no lower than min (or the next integer greater than min
 * if min isn't an integer) and no greater than max (or the next integer
 * lower than max if max isn't an integer).
 * Using Math.round() will give you a non-uniform distribution!
 */
function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}


function getRandomUniform(min, max) {
    return min + (max - min) * Math.random();
}

function sleep(time) {
    return new Promise(resolve => setTimeout(resolve, time));
}


class Live {
    constructor({url, index, urls, options}) {
        this._url = url;
        this._index = index;
        this._urls = urls;
        this._options = options;
    }

    async load() {
        // create a fresh new context for this URL
        const context = new Context(this._options);
        const client = await context.create();
        // hooks
        const {preHook, postHook} = this._options;
        const hookArgs = [this._url, client, this._index, this._urls];
        // optionally run the user-defined hook
        if (typeof preHook === 'function') {
            await preHook.apply(null, hookArgs);
        }
        // create (but not start) the page timer
        const timer = new Timer(this._options.timeout);
        // handle proper page load and postHook or related errors
        const pageLoad = async () => {
            try {
                // start the page load and waits for its termination
                const stats = await this._loadPage(client);
                // optionally run the user-defined hook
                if (typeof postHook === 'function') {
                    stats.user = await postHook.apply(null, hookArgs);
                }
                return stats;
            } finally {
                // no-matter-what cleanup functions
                await context.destroy();
                timer.cancel();
            }
        };
        // handle Chrome disconnection
        const disconnection = async () => {
            await new Promise((fulfill, reject) => {
                client.once('disconnect', fulfill);
            });
            timer.cancel();
            throw new Error('Disconnected');
        };
        // handle page timeout
        const timeout = async () => {
            await timer.start();
            await context.destroy();
            throw new Error('Timed out');
        };
        // wait for the first event to happen
        return await Promise.race([
            pageLoad(),
            disconnection(),
            timeout()
        ]);
    }

    async _loadPage(client) {
        // enable domains
        const {Page, Network, Input} = client;
        await Network.enable();
        await Page.enable();
        // register events
        const stats = new Stats(this._url, this._options);
        const termination = new Promise((fulfill, reject) => {
            client.on('event', (event) => {
                stats.processEvent(fulfill, reject, event);
            });
            // XXX the separation of concerns between live fetching and HAR
            // computation made it necessary to introduce a synthetic event
            // which is the reply of the Network.getResponseBody method
            if (this._options.content) {
                Network.loadingFinished(async ({requestId}) => {
                    // only for those entries that are being tracked (e.g., not
                    // for cached items)
                    if (!stats.entries.get(requestId)) {
                        return;
                    }
                    try {
                        const params = await Network.getResponseBody({requestId});
                        const {body, base64Encoded} = params;
                        stats.processEvent(fulfill, reject, {
                            method: 'Network.getResponseBody',
                            params: {
                                requestId,
                                body,
                                base64Encoded
                            }
                        });
                    } catch (err) {
                        // sometimes it is impossible to fetch the content (see #82)
                        stats.processEvent(fulfill, reject, {
                            method: 'Network.getResponseBody',
                            params: {
                                requestId
                            }
                        });
                    }
                });
            }
        });
        // start the page load
        const navigation = Page.navigate({url: this._url});

        // events will determine termination
        await Promise.all([termination, navigation]);

        // We scroll a bit to simulate user interaction
        const initial_layout = await Page.getLayoutMetrics();
        const height = initial_layout['contentSize']['height'];
        const viewport_height = initial_layout['visualViewport']['clientHeight'];
        const viewport_width = initial_layout['visualViewport']['clientWidth'];
        const x = getRandomInt(0, viewport_width - 1);
        const y = getRandomInt(0, viewport_height - 1);
        const max_scrolldown = getRandomInt(height / 2.5, height / 1.5);
        let last_page_y = 0;
        let end = false;
        while (end != true) {
            const distance = getRandomInt(100, 300);
            const scroller = await Input.dispatchMouseEvent(
                {type: 'mouseWheel',
                 x:x, y:y, deltaX:0, deltaY:distance});
            const layout = await Page.getLayoutMetrics();
            const page_y = layout['visualViewport']['pageY'];
            if (page_y + viewport_height >= max_scrolldown || page_y <= last_page_y) {
                end = true;
            } else {
                last_page_y = page_y;
                await sleep(getRandomInt(50, 150))
            }
        };

        await sleep(getRandomInt(550, 2150))

        return stats;
    }
}

module.exports = Live;
