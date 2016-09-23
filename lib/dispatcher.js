'use strict'

const EventEmitter = require('events').EventEmitter
const Promise = require('bluebird')
const Settings = require('./settings')

/**
 * EVENTS
 *      queued - Event was queued up for execution
 *      disconnected - redis connection was lost
 *      reconnecting - redis connection is reconnecting
 *      connected - redis connection has resumed
 *      error - Error encountered
 *      pause - Pause the polling of the redis server
 *      start - Start/resume polling the redis server
 */
class Dispatcher extends EventEmitter {
    constructor({ running = true, redis } = {}) {
        super()

        this.running = running
        this.redis = redis

        this.redis.on('connect', () => {
            if (this.running) this.dispatch()
            this.emit('connected')
        })
        this.redis.on('end', () => {
            this.emit('end')
            this.running = false
        })
    }

    /**
     * Remove the events from the ordered set
     * 
     * @param events {Event[]}
     * 
     * @returns {Promise}
     */
    dequeue(events = []) {
        if (!Array.isArray(events)) events = [events]
        if (events.length === 0) return Promise.resolve()
        return this.redis.zremAsync(Settings.redis.ordered_set_name, ...events.map(e => e.getHash()))
    }

    /**
     * Fetch the next job to queue for execution
     */
    dispatch() {
        if (!this.running) return
        if (!this.redis.connected) return setTimeout(this.dispatch.bind(this), 1000) // Wait 1s if not connected
        this.redis
            .zrangebyscoreAsync(Settings.redis.ordered_set_name, 0, Date.now())
            .then(hashes => {
                if (hashes.length)
                    return this.redis
                        .multi()
                        .rpush(Settings.redis.queue_name, hashes[0])
                        .zrem(Settings.redis.ordered_set_name, hashes[0])
                        .execAsync()
                else 
                    throw new EmptyResultError()
            })
            .then(() => setImmediate(this.dispatch.bind(this)))
            .catch(err => {
                setTimeout(this.dispatch.bind(this), 1000)
                if (!(err instanceof EmptyResultError)) {
                    this.emit('error', err) // If err is not expected, forward to external handler
                }
            })
    }

    /**
     * Flush the ordered set of jobs
     * 
     * @returns {Promise}
     */
    flushJobs() {
        return this.redis.delAsync(Settings.redis.ordered_set_name)
    }

    /**
     * Pause this dispatcher, stopping it from polling jobs
     * 
     * NOTE: This only pauses automatic polling of jobs. Manually
     * calling Dispatcher#queue, #dequeue and #flushjobs will work
     * as long there is a connection to redis
     */
    pause() {
        this.running = false
        this.emit('pause')
    }

    /**
     * Queue these events in the ordered set
     * 
     * @param events {Event[]}
     * 
     * @returns {Promise}
     */
    queue(events = []) {
        if (!Array.isArray(events)) events = [events]
        if (events.length === 0) return Promise.resolve()

        let now = Date.now()
        let zadd_params = []
        events.forEach(e => {
            zadd_params.push(Math.max(e.run_at, 0))
            zadd_params.push(e.getHash())
	    })

        return this
            .dequeue(events)
            .then(() => this.redis.zaddAsync([Settings.redis.ordered_set_name, ...zadd_params]))
    }

    /**
     * Start polling for jobs
     */
    start() {
        this.running = true
        this.emit('start')
        if (this.redis.connected) this.dispatch()
    }
}

// Error representing an empty response from redis
class EmptyResultError extends Error {
	constructor() {
		super()
		this.name = 'EmptyResultError'
        this.message = 'No results found'
	}
}

module.exports = Dispatcher