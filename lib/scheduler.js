'use strict'

const Dispatcher = require('./dispatcher')
const Event = require('./event')
const Promise = require('bluebird')
const redis = require('redis')
const Worker = require('./worker')

class Scheduler {
    constructor(server, options = {}) {
        let {
            interval = 300,
            workers = 5,
            retries = 3,
            retry_timeout = 0,
            verbose = true
        } = options

        this.interval = interval * 1000 // to millis
        this.server = server
        this.v = verbose

        // Redis
        this.redis = redis.createClient(options.redis)
        Promise.promisifyAll(this.redis)

        this.redis.on('error', err => this.error(err, 'Redis'))
        this.redis.on('reconnecting', ({ attempt } = {}) => console.error(`Redis connection lost, reconnecting... attempt ${attempt}`))

        // Dispatcher
        this.dispatcher = new Dispatcher({ redis: this.redis })
        this.dispatcher.on('error', err => this.error(err, 'Dispatcher'))

        // Workers
        this.workers = []
        for (let i = 1; i <= workers; ++i) {
            options.name = 'Worker ' + i
            let worker = new Worker(options)

            worker.on('error', err => this.error(err, worker.name()))
            worker.on('execute', event => {
                if (this.v) console.log(`Executing event ${event.getHash()} on worker "${worker.name()}"`)
            })
            worker.on('retry', err => this.error(err, `${worker.name()} - attempt ${attempt}/${retries}`))
            worker.on('failed', ({ event , error } = {}) => event.save({ failed: true, failed_reason: error }))
            worker.on('done', ({ event } = {}) => event.recur().catch(this.error))

            this.workers.push(worker)
        }

        this._fetch()
    }

    /**
     * Create a new event
     * 
     * NOTE: If the new event's run time occurs before the next
     * Scheduler#_fetch, the event is queued up for execution
     * 
     * @param slug {String}
     * @param key {String} optional
     * @param props {Object}
     * 
     * @returns {Promise}
     */
    add(slug, key, props = {}) {
        props.slug = slug
        props.key = key
        if (!props.run_at) {
            let error = new Error('Missing required field "run_at"')
            error.code = 400
            return Promise.reject(error)
        }
        
        return new Event(props)
            .save()
            .then(event => {
                let now = Date.now()
                if (event.run_at.getTime() <= now + this.interval) {
                    this.dispatchAt(event, event.run_at.getTime() - now)
                }
                return event
            })
    }

    /**
     * Delete the given event
     * 
     * @param slug {String}
     * @param key {String} optional
     * 
     * @returns {Promise}
     */
    del(slug, key) {
        let event = new Event(slug, key)
        if (this.v) console.log(`Deleting event ${hash}`)

        return this.dispatcher
            .dequeue(event)
            .then(() => event.destroy())
    }

    /**
     * Outputs the provided error
     * 
     * @param err {Error}
     * @param source {String} optional
     */
    error(err, source = 'Scheduler') {
        console.error(`${source} Error:`)
        console.error(err)
        console.error('Time: ', new Date())
    }

    /**
     * Get an event by slug+key
     * 
     * @params slug {String}
     * @params key {String} optional
     * 
     * @returns {Promise}
     */
    get(slug, key) {
        return Event.fetch(slug, key)
    }

    /**
     * Update the event with the given properties
     * 
     * NOTE: This function will queue up the event if it is to run
     * before the next Scheduler#_fetch call.  Likewise, it will
     * dequeue or requeue any queued events whose run times were
     * updated to be after the next Scheduler#_fetch or at some
     * other point in this interval, respectively
     * 
     * @params slug {String}
     * @params key {String} optional
     * @params updates {Object}
     * 
     * @returns {Promise}
     */
    update(slug, key, updates = {}) {
        return new Event({ slug, key })
            .save(updates)
            .then(event => {
                if (event.run_at.getTime() <= Date.now() + this.interval)
                    return this.dispatcher.queue(event).then(Promise.resolve(event))
                else
                    return this.dispatcher.dequeue(event).then(Promise.resolve(event))
            })
    }

    /**
     * Lists the events by their run times, in order of execution
     * 
     * @param before {Date} optional
     * @param after {Date} optional
     */
    list(before, after) {
        return Event.list(before, after)
    }

    /**
     * PRIVATE
     * Fetches the next group of events to be queued up for execution
     * 
     * @param __tries {Integer} optional
     * 
     * @returns {Promise}
     */
    _fetch(__tries = 0) {
        return Event
            .list(Date.now() + this.interval)
            .then(events => this.dispatcher.flushJobs().then(() => events)) // Clear the ordered set of jobs
            .then(events => this.dispatcher.queue(events)) // Repopulate the ordered set of jobs
            .then(() => setTimeout(() => this._fetch(), this.interval)) // Fetch after interval passed
            .catch(err => {
                this.error(err)
                setTimeout(() => this._fetch(), 1000) // Try again after 1 second
            })
    }
}

module.exports = Scheduler
