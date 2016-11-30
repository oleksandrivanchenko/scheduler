'use strict'

const _ = require('lodash')
const Promise = require('bluebird')
const Settings = require('./settings')

const collection = require('./db').db.collection(Settings.mongo.collection_name)
const collection_failed = require('./db').db.collection(Settings.mongo.collection_name + '_failed')

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
 *      body {Object} - Execution request body payload
 * }
 * run_at {Integer} - Millisecond UTC timestamp to execute event
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
            href,
            headers = {},
            method = 'POST',
            body = ''
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
            request: { href, headers, method, body },
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
            .removeOneAsync({
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
        this.failed_code = code
        this.failed_response = payload

        return this
            .destroy()
            .then(() => collection_failed.insertAsync(this))
            .then(() => ({ success: 'ok' }))
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
     * @param {object} updates any updates to apply when recurring
     * 
     * @returns {Event} this
     */
    recur() {
        this.run_at = Event.getNextOccurrence(this.run_at, this.recurring)
        return this
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
 * Takes the given timestamp and applies the `recurring` object, returning
 * the next time that the event should be run
 * 
 * @param {Date} ran_at time that the event had ran/should run at
 * @param {object} recurring hash of the number of intervals of time to add to the run_at
 * @param {(number|null)} recurring.years
 * @param {(number|null)} recurring.months
 * @param {(number|null)} recurring.weeks
 * @param {(number|null)} recurring.days
 * @param {(number|null)} recurring.hours
 * @param {(number|null)} recurring.minutes
 * @param {(number|null)} recurring.seconds
 * @param {(number|null)} recurring.milliseconds
 * 
 * @returns {Date}
 */
Event.getNextOccurrence = (ran_at, recurring = {}) => {
    if (typeof recurring !== 'object') return ran_at
    for (let i in recurring) {
        switch (i.toLowerCase()) {
            case 'years':
                ran_at.setFullYear(ran_at.getFullYear() + recurring[i])
                break
            case 'months':
                ran_at.setMonth(ran_at.getMonth() + recurring[i])
                break
            case 'weeks':
                ran_at.setDate(ran_at.getDate() + (recurring[i] * 7))
                break
            case 'days':
                ran_at.setDate(ran_at.getDate() + recurring[i])
                break
            case 'hours':
                ran_at.setHours(ran_at.getHours() + recurring[i])
                break
            case 'minutes':
                ran_at.setMinutes(ran_at.getMinutes() + recurring[i])
                break
            case 'seconds':
                ran_at.setSeconds(ran_at.getSeconds() + recurring[i])
                break
            case 'milliseconds':
                ran_at.setMilliseconds(ran_at.getMilliseconds() + recurring[i])
                break
            default:
                break
        }
    }

    return ran_at
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
 * @param before {Integer} optional
 * @param after {Integer} optional
 * @param showFailed {Boolean} optional
 * 
 * @returns {Promise}
 */
Event.list = ({ slug, before, after, failed } = {}) => {
    let query = { }

    if (slug) query.slug = slug
    if (before || after) {
        query.run_at = {}
        if (before) query.run_at.$lte = before
        if (after) query.run_at.$gte = after
    }

    return (
            failed === true
            ? collection_failed
            : collection
        )
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
        if (
            obj.hasOwnProperty(key)
            && key !== 'request.body' // body should be updated as a whole
            && typeof obj[key] === 'object'
            && !Array.isArray(obj[key])
            && !(obj[key] instanceof Date)
        ) {
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
    if (obj.run_at) result.run_at = parseInt(obj.run_at, 10)
    if (obj.failed_response !== undefined) result.failed_response = obj.failed_response === null ? null : String(obj.failed_response)
    if (obj.failed_code !== undefined) result.failed_code = obj.failed_code === null ? null : parseInt(obj.failed_code, 10)
    if (obj.recurring != null) {
        if (typeof obj.recurring === 'object') {
            result.recurring = {
                years: obj.recurring.years ? parseInt(obj.recurring, 10) : 0,
                months: obj.recurring.months ? parseInt(obj.recurring, 10) : 0,
                weeks: obj.recurring.weeks ? parseInt(obj.recurring, 10) : 0,
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

    if (obj.request) {
        result.request = {
            href: obj.request.href,
            headers: obj.request.headers,
            method: obj.request.method == null ? obj.request.method : String(obj.request.method),
            body: _.isObject(obj.request.body) ? obj.request.body : null,
        }
    }

    return result
}

module.exports = Event