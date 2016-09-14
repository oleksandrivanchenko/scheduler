'use strict'

const collection = require('./db').db.collection('events')
const Promise = require('bluebird')
const Settings = require('./settings')

const FIELDS = ['slug', 'key', 'request', 'run_at', 'recurring', 'failed', 'failed_code', 'failed_response']

/**
 * Model Scheme
 * 
 * _id {MongoID} - Automatic ID, unused
 * slug {String} - Category portion of the event's hash (i.e. assignment-notif)
 * key {String} - optional, unique ID for this event (i.e. assignment-notif::ad5fcea85d6ec6aacd5ae8c)
 * request {
 *      host {String} - Host to request on execution
 *      protocol {String} - Protocol to use (default http:)
 *      port {Integer} - Port to request on (default 80)
 *      headers {Object} - Map of headers
 *      method {String} - HTTP method to use (default POST)
 *      path {String} - Path of request, including querystring if applicable (default /)
 *      data {Anything} - Execution request payload
 * }
 * run_at {Date} - DateTime to execute event
 * recurring {Boolean|Object} - False if not recurring, else formatted recurring object (see below)
 * failed {Boolean} - If this event was executed but failed, will be true
 * failed_code {Integer|null} - HTTP response code from failed execution request
 * failed_response {String|null} - HTTP response body from failed execution
 * 
 * 
 * Recurring field scheme:
 * {
 *      years {Integer} - # of years in interval
 *      months {Integer} - # of months in interval
 *      weeks {Integer} - # of weeks in interval
 *      days {Integer} - # of days in interval
 *      hours {Integer} - # of hours in interval
 *      minutes {Integer} - # of minutes in interval
 *      seconds {Integer} - # of seconds in interval
 *      milliseconds {Integer} - # of milliseconds in interval
 * }
 */

class Event {
    constructor({
        slug = 'event-slug',
        key = '',
        request : {
            host,
            protocol = 'http:',
            port = 80,
            headers = {},
            method = 'POST',
            path = '/',
            data = ''
        } = {},
        run_at,
        recurring = false,
        failed = false,
        failed_code = null,
        failed_response = null
    } = {}) {
        let obj = {
            slug,
            key,
            request: { host, protocol, port, headers, method, path, data },
            run_at,
            recurring,
            failed,
            failed_code,
            failed_response
        }

        obj = formatFields(obj)

        for (let key in obj) {
            if (obj.hasOwnProperty(key)) this[key] = obj[key]
        }
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
     * Fails this event with the given payload
     * 
     * @param payload {String} Response body of failed request
     * @param code {Integer} HTTP response code from failed request
     * 
     * @returns {Promise}
     */
    fail(payload = null, code = null) {
        return this.save({
            failed: true,
            failed_code: code,
            failed_response: payload
        })
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
        // If this event does not recur, delete it
        if (!this.recurring) return this.destroy()

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

            changes = formatFields(changes)
            collapseUpdateObject(changes)
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
            .then(({ value } = {}) => {
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
Event.getHash = (slug, key = '') => slug+Settings.hash_delimiter+key

/**
 * Convert the hash to a slug and key object
 * 
 * @param hash {String}
 * 
 * @returns {[ slug {String}, key {String} ]}
 */
Event.fromHash = (hash) => {
    let split_at = hash.indexOf(Settings.hash_delimiter)
    if (split_at === -1) return [hash, '']

    return [
        hash.substr(0, split_at),
        hash.substr(split_at + Settings.hash_delimiter.length)
    ]
}

/**
 * List events that fall within the given time range
 * 
 * @param before {Date} optional
 * @param after {Date} optional
 * @param showFailed {Boolean} optional
 * 
 * @returns {Promise}
 */
Event.list = ({ slug, before, after, failed } = {}) => {
    let query = { }

    if (slug) query.slug = slug
    if (typeof failed === 'boolean') query.failed = failed
    if (before || after) {
        query.run_at = {}
        if (before) {
            query.run_at.$lte = new Date(before)
        }
        if (after) {
            query.run_at.$gte = new Date(after)
        }
    }

    return collection
        .find(query)
        .toArrayAsync()
        .then(events => events.map(e => new Event(e)))
}

/**
 * Collapse an object that represents the fields sent to mongodb#update's $set field.
 * Uses dot-notation so that objects arent overwritten in their entirety.
 * 
 * NOTE: This mutates the given argument
 * 
 * i.e.
 * before: { this: 1, that: { the: 1, other: 'thing' } }
 * after: { this: 1, that.the: 1, that.other: 'thing' }
 * 
 * @param obj {Object}
 */
function collapseUpdateObject(obj) {
    let isDone = true
    for (let key in obj) {
        if (obj.hasOwnProperty(key) && typeof obj[key] === 'object' && !Array.isArray(obj[key]) && !(obj[key] instanceof Date)) {
            isDone = false
            for (let subkey in obj[key]) {
                if (obj[key][subkey] !== undefined) obj[`${key}.${subkey}`] = obj[key][subkey]
            }
            delete obj[key]
        }
    }

    if (!isDone) collapseUpdateObject(obj)
}

/**
 * Trims and formats the fields on the object to be a valid Event
 * 
 * @param obj {Object}
 * @param trim {Boolean} optional, if true, will remove all non-event fields on obj
 * 
 * @returns {Object}
 */

const false_boolean_values = ['f', 'false', '0', 'no', 'not', 'null']
function formatFields(obj, trim = true) {
    let result = {}

    if (obj.slug) result.slug = String(obj.slug)
    if (obj.key) result.key = String(obj.key)
    if (obj.run_at) result.run_at = new Date(obj.run_at)
    if (obj.failed_response !== undefined) result.failed_response = obj.failed_response === null ? null : String(obj.failed_response)
    if (obj.failed_code !== undefined) result.failed_code = obj.failed_code === null ? null : parseInt(obj.failed_code, 10)
    if (obj.recurring != null) {
        if (typeof obj.recurring === 'object') {
            result.recurring = {
                years: obj.recurring ? parseInt(obj.recurring, 10) : 0,
                months: obj.recurring ? parseInt(obj.recurring, 10) : 0,
                weeks: obj.recurring ? parseInt(obj.recurring, 10) : 0,
                days: obj.recurring ? parseInt(obj.recurring, 10) : 0,
                hours: obj.recurring ? parseInt(obj.recurring, 10) : 0,
                minutes: obj.recurring ? parseInt(obj.recurring, 10) : 0,
                seconds: obj.recurring ? parseInt(obj.recurring, 10) : 0,
                milliseconds: obj.recurring ? parseInt(obj.recurring, 10) : 0
            }
        } else {
            result.recurring = false
        }
    }
    if (obj.failed != null) {
        if (typeof obj.failed === 'boolean') result.failed = obj.failed
        result.failed = !false_boolean_values.includes(String(obj.failed).toLowerCase())
    }
    if (obj.request) {
        result.request = {
            host: obj.request.host == null ? obj.request.host : String(obj.request.host),
            protocol: obj.request.protocol == null ? obj.request.protocol : String(obj.request.protocol),
            port: obj.request.port == null ? obj.request.port : parseInt(obj.request.port, 10),
            headers: obj.request.headers,
            method: obj.request.method == null ? obj.request.method : String(obj.request.method),
            path: obj.request.path == null ? obj.request.path : String(obj.request.path),
            data: obj.request.data
        }
    }

    return result
}

module.exports = Event