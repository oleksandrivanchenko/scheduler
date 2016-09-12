'use strict'

const Event = require('./event')
const EventEmitter = require('events').EventEmitter
const http = require('http')
const https = require('https')
const Settings = require('./settings')

/**
 * TODO
 *      - Auth integration for requests
 * 
 * EVENTS
 *      done - Request completed successfully
 *      error - Error encountered
 *      failed - Request failed to execute
 *      retry - Request failed, retrying
 *      execute - Event is being executed
 */

class Worker extends EventEmitter {
    constructor({ name = 'Worker', redis, running = true }) {
        super()

        this.worker_name = name
        this.redis = redis
        this.retries = Settings.retries
        this.timeout = Settings.retry_timeout
        this.running = running

        if (Settings.verbose) console.log('Finished constructing ' + name)
        this.redis.on('connect', () => setImmediate(this.getJob.bind(this)))
    }

    /**
     * Executes the provided event
     * 
     * @param event {Event}
     * @param __tries {Integer} optional
     */
    execute(event, __tries = 1) {
        if (!this.running) return

        this.emit('execute', event)

        let _this = this
        
        try {
            let req = (event.request.protocol === 'https:' ? https : http).request(event.request, res => {
                let body = ''
                res.on('data', chunk => body += chunk)
                res.on('end', () => {
                    if (String(res.statusCode)[0] !== '2') fail(body, res.statusCode)
                    else done(res.statusCode, body)
                })
                res.on('error', fail)
            })
            req.write(typeof event.request.data === 'string' ? event.request.data : JSON.stringify(event.request.data))
            req.end()
            req.on('error', fail)
        } catch (e) {
            fail(e)
        }

        function done(status, body) {
            _this.emit('done', { event, response })
            setImmediate(_this.getJob.bind(_this))
        }

        // NOTE response 501 means error with request object
        function fail(error, code = 501) {
            if (__tries === _this.retries) {
                event.fail(error, code).then(() => {
                    _this.emit('failed', error, event, __tries)
                    setImmediate(_this.getJob.bind(_this))
                })
            } else {
                _this.emit('retry', error, event, __tries)
                setTimeout(() => _this.execute(event, ++__tries), _this.timeout)
            }
        }
    }

    /**
     * Fetch the next job in the queue to be executed
     * 
     * NOTE: This performs a blocking pop on redis
     */
    getJob() {
        if (!this.redis.connected) return setTimeout(this.getJob.bind(this), 1000) // Wait 1s if not connected
        this.redis
            .blpopAsync(Settings.redis.queue_name, 0)
            .then(([,hash]) => {
                if (hash) {
                    Event
                        .fetch(...Event.fromHash(hash))
                        .then(event => event ? this.execute(event) : setImmediate(this.getJob.bind(this))) 
                } else {
                    setImmediate(this.getJob.bind(this))
                }
            })
            .catch(err => {
                this.emit('error', err)
                setTimeout(this.getJob.bind(this), 1000)
            })
    }

    /**
     * Get this worker's name
     * 
     * @returns {String}
     */
    name() {
        return this.worker_name
    }
}

module.exports = Worker