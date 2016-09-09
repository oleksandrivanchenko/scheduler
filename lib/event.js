'use strict'

const collection = require('./db').db.collection('events')
const error = require('./error') // TODO error? remove?
const Promise = require('bluebird')

Promise.promisifyAll(collection)

const FIELDS = ['slug', 'key', 'endpoint', 'recurring', 'run_at', 'failed', 'failed_reason', 'payload']
class Event {
    constructor({
        slug = 'event-slug',
        key = '', 
        endpoint = '',
        run_at,
        recurring = false,
        failed = false,
        failed_reason = null,
        payload = {}
    } = {}) {
        this.slug = slug
        this.key = key
        this.endpoint = endpoint
        this.recurring = recurring
        this.failed = failed
        this.failed_reason = failed_reason
        this.run_at = run_at ? new Date(run_at) : undefined
        this.payload = payload
    }
    
    /**
     * Delete this event
     * 
     * @returns {Promise}
     */
    destroy() {
        return collection
            .removeOne({
                slug: this.slug,
                key: this.key
            })
            .then(result => result.deletedCount > 0)
    }
    
    /**
     * Get the formatted hash string of this event
     * 
     * @returns {String}
     */
    getHash() {
        return Event.getHash(this.slug, this.key)
    }
    
    /**
     * Increment the run_at timestamp by the event's recur settings
     * 
     * @returns {Promise}
     */
    recur() {
        if (!this.recurring) return Promise.resolve(this)
        
        for (let i in this.recurring) {
            switch (i.toLowerCase()) {
                case 'years':
                    this.run_at.setFullYear(this.run_at.getFullYear() + this.recurring[i])
                    break
                case 'months':
                    this.run_at.setMonth(this.run_at.getMonth() + this.recurring[i])
                    break
                case 'weeks':
                    this.run_at.setDate(this.run_at.getDate() + (this.recurring[i] * 7))
                    break
                case 'days':
                    this.run_at.setDate(this.run_at.getDate() + this.recurring[i])
                    break
                case 'hours':
                    this.run_at.setHours(this.run_at.getHours() + this.recurring[i])
                    break
                case 'minutes':
                    this.run_at.setMinutes(this.run_at.getMinutes() + this.recurring[i])
                    break
                case 'seconds':
                    this.run_at.setSeconds(this.run_at.getSeconds() + this.recurring[i])
                    break
                case 'milliseconds':
                    this.run_at.setMilliseconds(this.run_at.getMilliseconds() + this.recurring[i])
                    break
                default:
                    break
            }
        }
        
        return this.save({ run_at: this.run_at })
    }
    
    /**
     * Save the changes on this event
     * 
     * @param changes {Object} optional, if empty saves the data on the event object
     * 
     * @returns {Promise}
     */
    save(changes) {
        if (!slug) {
            let err = new Error('Missing event slug')
            err.code = 400
            return Promise.reject(err)
        }

        if (!changes) {
            changes = {}
            for (let i of Object.keys(this)) {
                if (FIELDS.includes(i)) changes[i] = this[i]
            }
        } else {
            let _tmp = {}
            for (let i of FIELDS) {
                if (changes[i] !== undefined) _tmp[i] = changes[i]
            }
            if (!Object.keys(_tmp)) {
                let err = new Error('Missing event updates')
                err.code = 400
                return Promise.reject(err)
            }
        }
        
        return collection
            .findOneAndUpdateAsync({
                slug: this.slug,
                key: this.key
            }, {
                $set: changes
            }, {
                upsert: true,
                returnOriginal: false
            })
            .then(({ value }) => {
                for (let i in value) {
                    if (i !== '_id' && value.hasOwnProperty(i)) this[i] = value[i]
                }
                return this
            })
    }
}

/**
 * Fetch an event object by its slug and key
 * 
 * @param slug {String}
 * @param key {String} optional
 * @returns {Promise}
 */
Event.fetch = (slug, key) => {
    if (!slug) {
        let err = new Error('Missing event slug')
        err.code = 400
        return Promise.reject(err)
    }
    
    return collection
        .findOneAsync({ slug, key })
        .then(event => event ? new Event(event) : null)
}

/**
 * Convert the given slug and key to the hash representation
 * 
 * @param slug {String}
 * @param key {String} optional
 * @returns {Promise}
 */
Event.getHash = (slug, key) => `${slug}::${key}`

/**
 * List events that fall within the given time range
 * 
 * @param before {Date} optional
 * @param after {Date} optional
 * @param showFailed {Boolean} optional
 * 
 * @returns {Promise}
 */
Event.list = (before, after, showFailed = false) => {
    let query = { run_at: {} }
    
    if (before) {
        query.run_at.$lte = new Date(before)
    }
    if (after) {
        query.run_at.$gte = new Date(after)
    }
    
    return collection
        .find(query)
        .toArrayAsync()
        .then(events => events.map(e => { return new Event(e) }))
}

module.exports = Event