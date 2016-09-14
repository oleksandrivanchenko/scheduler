'use strict'

const _ = require('lodash')
const Event = require('./event')
const EventEmitter = require('events').EventEmitter
const http = require('http')
const https = require('https')
const Promise = require('bluebird')
const Request = require('request')
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

        let _this = this
        this.emit('execute', event)

        try {
            Request({
                url: `${protocol}//${event.request.host}${event.request.port ? ':'+event.request.port : ''}${event.request.path}`,
                method: event.request.method,
                headers: event.request.headers,
                qs: event.request.querystring,
                json: event.request.body
            }, (error, response, body) => {
                if (error) fail(error)
                else done(response.statusCode, body)
            }) 
        } catch (e) {
            fail(e)
        }

        function done(status, body) {
            _this.emit('done', event, body)
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

/**
 * Turn an object into a url encoded representation with bracket notation
 * 
 * @param obj {Object}
 * @param _parent {String} private, optional, parent object (i.e. parent[child][age] = 8 vs child[age] = 8)
 * 
 * @returns {String}
 */
function encodeURIObject(obj, _parent) {
    let str = ''
    for (let key in obj) {
        let current_key = _parent ? `${_parent}[${key}]` : key
        if (_.isDate(obj[key])) {
            str += current_key + '=' + obj[key].toISOString() + '&'
        } else if (_.isObject(obj[key])) {
            str += encodeURIObject(obj[key], current_key)
        } else {
            str += current_key + '=' + obj[key] + '&'
        }
    }

    return _parent ? str : str.substr(0, str.length - 1)
}

module.exports = Worker