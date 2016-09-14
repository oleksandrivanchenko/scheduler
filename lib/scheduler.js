'use strict'

const Dispatcher = require('./dispatcher')
const Event = require('./event')
const Promise = require('bluebird')
const redis = require('redis')
const Settings = require('./settings')
const Worker = require('./worker')

Promise.promisifyAll(redis)

class Scheduler {
    constructor() {
        this.interval = Settings.interval * 1000 // to millis

        // Dispatcher
        this.dispatcher = new Dispatcher({ redis: redis.createClient(Settings.redis) })
        this.dispatcher.on('error', err => this.error(err, 'Dispatcher'))

        // Workers
        this.workers = []
        let redis_worker_client = redis.createClient(Settings.redis)
        for (let i = 1; i <= Settings.workers; ++i) {
            let worker = new Worker({ name: 'Worker ' + i, redis: redis_worker_client })

            worker.on('error', err => this.error(err, worker.name()))
            worker.on('execute', event => {
                if (Settings.verbose) console.log(`Executing event ${event.getHash()} on worker "${worker.name()}"`)
            })
            worker.on('retry', (error, event, attempt) => this.error(error, `${worker.name()} - attempt ${attempt}/${Settings.retries}`))
            worker.on('failed', (error, event, attempts) => this.error(error, `${worker.name()} - Failed executing event ${event.getHash()} after ${attempts} attempts`))
            worker.on('done', event => {
                if (Settings.verbose) console.log(`Finished executing event ${event.getHash()}`)
                event.recur().catch(this.error)
            })

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
        if (!props.request) {
            let error = new Error('Missing required field "request"')
            error.code = 400
            return Promise.reject(error)
        }
        if (props.request.protocol && props.request.protocol !== 'http:' && props.request.protocol != 'https:') {
            let error = new Error('Invalid protocol in request[protocol]. Supported protocols: "http:", "https:"')
            error.code = 400
            return Promise.reject(error)
        }
        
        if (Settings.verbose) console.log(`Creating new event ${Event.getHash(slug, key)}`)
        
        return new Event(props)
            .save()
            .then(event => {
                if (event.run_at.getTime() <= Date.now() + this.interval) {
                    if (Settings.verbose) console.log(`Queueing new event ${event.getHash()}`)
                    this.dispatcher.queue(event)
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
        let event = new Event({ slug, key })
        if (Settings.verbose) console.log(`Deleting event ${event.getHash()}`)

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
        if (Settings.verbose) console.log(`Fetching event ${Event.getHash(slug, key)}`)
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
        if (Settings.verbose) console.log(`Updating event ${Event.getHash(slug, key)}`)
        return new Event({ slug, key })
            .save(updates)
            .then(event => {
                if (event.run_at.getTime() <= Date.now() + this.interval) {
                    if (Settings.verbose) console.log(`Queueing updated event ${event.getHash()}`)
                    return this.dispatcher.queue(event).then(() => Promise.resolve(event))
                } else {
                    if (Settings.verbose) console.log(`Dequeueing updated event ${event.getHash()}`)
                    return this.dispatcher.dequeue(event).then(() => Promise.resolve(event))
                }
            })
    }

    /**
     * Lists the events by their run times, in order of execution
     * 
     * @param before {Date} optional
     * @param after {Date} optional
     * @param failed {Boolean} optional
     */
    list() {
        if (Settings.verbose) console.log('Listing events')
        return Event.list(...arguments)
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
        if (Settings.verbose) console.log('Fetching next batch of events')
        return Event
            .list({ before: Date.now() + this.interval, failed: false })
            .then(events => this.dispatcher.flushJobs().then(() => events)) // Clear the ordered set of jobs
            .then(events => this.dispatcher.queue(events)) // Repopulate the ordered set of jobs
            .then(() => setTimeout(this._fetch.bind(this), this.interval)) // Fetch after interval passed
            .catch(err => {
                this.error(err)
                setTimeout(this._fetch.bind(this), 1000) // Try again after 1 second
            })
    }
}

module.exports = Scheduler
