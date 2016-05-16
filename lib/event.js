'use strict'

const error = require('./error')
const coll = require('./db').db.collection('events')

const FIELDS = ['slug', 'key', 'endpoint', 'recurring', 'run_at', 'fail_count', 'payload']
class Event {
    constructor({
        slug = 'event-slug',
        key = '', 
        endpoint = '',
        run_at,
        recurring = false,
        payload = {},
        fail_count
    } = {}) {
        this.slug = slug
        this.key = key
        this.endpoint = endpoint
        this.recurring = recurring
        this.run_at = run_at ? new Date(run_at) : undefined,
        this.fail_count = fail_count
        this.payload = payload
    }
    
    destroy() {
        return new Promise((resolve, reject) => {
            if (!this.slug) {
                return reject(error({
                    code: 400,
                    msg: 'Missing event slug'
                }))
            }
            coll.removeOne({
                slug: this.slug,
                key: this.key
            }, (err, result) => {
                if (err) {
                    console.error(`Error deleting event ${this.getHash()}`)
                    console.error(err)
                    return reject(error({
                        code: 500,
                        msg: 'Error fetching events'
                    }))   
                } else {
                    resolve(result.deletedCount > 0)
                }
            })
        })
    }
    
    getHash() {
        return `${this.slug}:${this.key}`
    }
    
    // Uses ISODate format to represent date intervals
    recur() {
        return new Promise((resolve, reject) => {
            if (!this.slug) {
                return reject(error({
                    code: 400,
                    msg: 'Missing event slug'
                }))
            }
            if (!this.recurring) return resolve(this)
            
            for (let i in this.recurring) {
                switch (i.toLowerCase()) {
                    case 'years':
                        this.run_at.setYear(this.run_at.getYear() + this.recurring[i])
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
            
            this
                .save({ run_at: this.run_at })
                .then(resolve)
                .catch(reject)
        })
    }
    
    save(changes) {
        return new Promise((resolve, reject) => {
            if (!this.slug) {
                return reject(error({
                    code: 400,
                    msg: 'Missing event slug'
                }))
            }
            
            if (!changes) {
                changes = {}
                for (let i of Object.keys(this)) {
                    changes[i] = this[i]
                }
            } else {
                let _tmp = {}
                for (let i of FIELDS) {
                    if (changes[i] !== undefined) _tmp[i] = changes[i]
                }
                if (!Object.keys(_tmp)) {
                    return reject(error({
                        code: 400,
                        msg: 'No updates provided'
                    }))
                }
            }
            
            coll.findOneAndUpdate({
                slug: this.slug,
                key: this.key
            }, {
                $set: changes
            }, {
                upsert: true,
                returnOriginal: false
            }, (err, result) => {
                if (err) {
                    console.error(`Error saving event ${this.getHash()}`)
                    console.error('changes', changes)
                    console.error(err)
                    return reject(error({
                        code: 500,
                        msg: 'Error fetching events'
                    }))   
                }
                
                result = result.value
                for (let i in result) {
                    if (result.hasOwnProperty(i) && i !== '_id') {
                        this[i] = result[i]
                    }
                }
                resolve(this)
            })
        })
    }
}

Event.fetch = (slug, key) => {
    return new Promise((resolve, reject) => {
        if (!slug) {
            return reject(error({
                code: 400,
                msg: 'Missing event slug'
            }))
        }
        
        coll.find({
            slug: slug,
            key: key
        }).limit(1).next((err, result) => {
            if (err) {
                console.error(`Error fetching event ${slug}:${key}`)
                console.error(err)
                reject(error({
                    code: 500,
                    msg: 'Error fetching events'
                }))   
            } else {
                resolve(result ? new Event(result) : null)
            }
        })
    })
}

Event.list = (before, after) => {
    return new Promise((resolve, reject) => {
        let query = {}
        
        if (before || after) {
            if (before) {
                query.$lte = new Date(before)
            }
            if (after) {
                query.$gte = new Date(after)
            }
        } else {
            query.$lte = Date.now() + this.interval
        }
        
        coll.find({
            run_at: query
        }).toArray((err, events) => {
            if (err) {
                console.error('Error listing events')
                console.error('before', before)
                console.error('after', after)
                console.error(err)
                reject(error({
                    code: 500,
                    msg: 'Error listing events'
                }))   
            } else {
                resolve(events.map(e => { return new Event(e) }))
            }
        })
    })
}

module.exports = Event