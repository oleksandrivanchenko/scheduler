'use strict'

const EventEmitter = require('events').EventEmitter

const REDIS_JOB_ZSET = 'scheduler-delayed-set'
const REDIS_JOB_QUEUE = 'scheduler-job-queue'

/**
 * EVENTS
 *      queued - Event was queued up for execution
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
        if (!this.redis.connected) return Promise.reject(new Error('Redis not connected'))
        if (!Array.isArray(events)) events = [events]
        return this.redis.zremAsync(REDIS_JOB_ZSET, ...events.map(e => e.getHash()))
    }

    /**
     * Fetch the next job to queue for execution
     * 
     * @returns {Promise}
     */
    dispatch() {
        if (!this.redis.connected || !this.running) return Promise.resolve()
        return this.redis
            .zrangebyscoreAsync(REDIS_JOB_ZSET, 0, Date.now())
            .then(hashes => { if (hashes.length) return hashes[0]; else throw new EmptyResultError() })
            .then(hash => this.redis
                .multi()
                .rpush(REDIS_JOB_QUEUE, hash)
                .zrem(REDIS_JOB_ZSET, hash)
                .execAsync())
            .then(() => this.dispatch())
            .catch(err => {
                setTimeout(() => this.dispatch(), 1000)
                if (!err instanceof EmptyResultError) this.emit('error', err) // If err is not expected, forward to external handler
            })
    }

    /**
     * Flush the ordered set of jobs
     * 
     * @returns {Promise}
     */
    flushJobs() {
        if (!this.redis.connected) return Promise.reject(new Error('Redis not connected'))
        return this.redis.delAsync(REDIS_JOB_ZSET)
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
        if (!this.redis.connected) return Promise.reject(new Error('Redis not connected'))

        if (!Array.isArray(events)) events = [events]

        let now = Date.now()
        let zadd_params = []
        events.forEach(e => {
            zadd_params.push(Math.max(e.run_at.getTime() - now, 0))
            zadd_params.push(e.getHash())
	    })

        return this
            .dequeue(events)
            .then(() => this.redis.zaddAsync([REDIS_JOB_ZSET, ...zadd_params]))
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